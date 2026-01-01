/**
 * WebContainer Runtime - Browser-based Node.js execution environment
 */

import { WebContainer, FileSystemTree, WebContainerProcess } from '@webcontainer/api';
import {
  VirtualNode,
  VirtualFile,
  VirtualDirectory,
  ProcessInfo,
  ProcessOutput,
  SpawnOptions,
  TerminalSession,
  ServerInfo,
  WebContainerState,
  WebContainerEvent,
  WebContainerEventHandler,
  WebContainerRuntimeOptions,
} from './types';
import { ProcessMonitor } from './processMonitor';
import { validateCOEP } from './serverUtils';

// ============================================
// WEBCONTAINER RUNTIME CLASS
// ============================================

export class WebContainerRuntime {
  private static instance: WebContainerRuntime | null = null;
  
  private state: WebContainerState = {
    booted: false,
    instance: null,
    processes: new Map(),
    servers: new Map(),
    terminalSessions: new Map(),
  };

  private eventHandlers: Set<WebContainerEventHandler> = new Set();
  private options: WebContainerRuntimeOptions;
  private processCounter = 0;
  private sessionCounter = 0;
  private processHandles: Map<string, WebContainerProcess> = new Map();
  private processMonitor = new ProcessMonitor();
  private packageCache: Map<string, { success: boolean; timestamp: number; output: string }> = new Map();

  private constructor(options: WebContainerRuntimeOptions = {}) {
    this.options = options;
    if (options.onEvent) {
      this.eventHandlers.add(options.onEvent);
    }
  }

  // ============================================
  // SINGLETON PATTERN
  // ============================================

  static getInstance(options?: WebContainerRuntimeOptions): WebContainerRuntime {
    if (!WebContainerRuntime.instance) {
      WebContainerRuntime.instance = new WebContainerRuntime(options);
    }
    return WebContainerRuntime.instance;
  }

  static async destroy(): Promise<void> {
    if (WebContainerRuntime.instance) {
      await WebContainerRuntime.instance.teardown();
      WebContainerRuntime.instance = null;
    }
  }

  // ============================================
  // LIFECYCLE
  // ============================================

  async boot(): Promise<boolean> {
    if (this.state.booted && this.state.instance) {
      return true;
    }

    try {
      // Validate COEP option
      const coep = this.options.coep || 'credentialless';
      if (coep !== 'credentialless' && coep !== 'require-corp') {
        throw new Error(`Invalid COEP option: ${String(coep)}`);
      }

      const bootOpts = {
        workdirName: this.options.workdirName || 'workspace',
        coep,
      } as any;

      const bootPromise = (WebContainer as any).boot(bootOpts);

      const timeoutMs = this.options.bootTimeout ?? 30000;
      const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('WebContainer boot timeout')), timeoutMs));

      this.state.instance = await Promise.race([bootPromise, timeoutPromise]);

      // Listen for server-ready events
      this.state.instance.on('server-ready', async (port, url) => {
        this.state.servers.set(port, { port, url, ready: true });
        // best-effort: check server headers for COOP/COEP
        try {
          if (validateCOEP(this.options.coep)) {
            try {
              const res = await fetch(url, { method: 'GET' as any });
              const coop = res.headers.get('cross-origin-opener-policy');
              const coepHeader = res.headers.get('cross-origin-embedder-policy');
              if (!coop || !coepHeader) {
                this.emit({ type: 'error', message: `Server at ${url} missing COOP/COEP headers` });
              }
            } catch {
              // ignore network errors
            }
          }
        } catch {}

        this.emit({ type: 'server-ready', port, url });
      });

      this.state.booted = true;
      this.emit({ type: 'boot', success: true });
      return true;
    } catch (error) {
      this.emit({ type: 'error', message: `Boot failed: ${String(error)}` });
      this.emit({ type: 'boot', success: false });
      return false;
    }
  }

  async teardown(): Promise<void> {
    // Kill all processes
    for (const [id] of Array.from(this.state.processes.keys())) {
      try {
        await this.killProcess(id);
      } catch {
        // best-effort
      }
    }

    // Close all terminal sessions
    for (const [id] of Array.from(this.state.terminalSessions.keys())) {
      try {
        await this.closeTerminalSession(id);
      } catch {
        // best-effort
      }
    }

    // Attempt to gracefully destroy underlying instance if supported
    try {
      if (this.state.instance && typeof (this.state.instance as any).destroy === 'function') {
        await (this.state.instance as any).destroy();
      }
    } catch {
      // ignore
    }

    this.state = {
      booted: false,
      instance: null,
      processes: new Map(),
      servers: new Map(),
      terminalSessions: new Map(),
    };

    // Clear event handlers
    this.eventHandlers.clear();
    // Clear monitors and handles
    try {
      this.processMonitor.clearAll();
    } catch {}
    this.processHandles.clear();
  }

  isBooted(): boolean {
    return this.state.booted && this.state.instance !== null;
  }

  // ============================================
  // FILE SYSTEM OPERATIONS
  // ============================================

  async writeFile(path: string, content: string): Promise<void> {
    this.ensureBooted();
    await this.state.instance!.fs.writeFile(path, content);
    this.emit({ type: 'file-change', path, event: 'create' });
  }

  async readFile(path: string): Promise<string> {
    this.ensureBooted();
    return await this.state.instance!.fs.readFile(path, 'utf-8');
  }

  async readDir(path: string): Promise<string[]> {
    this.ensureBooted();
    const entries = await this.state.instance!.fs.readdir(path, { withFileTypes: true });
    return entries.map(e => e.name);
  }

  async mkdir(path: string): Promise<void> {
    this.ensureBooted();
    await this.state.instance!.fs.mkdir(path, { recursive: true });
    this.emit({ type: 'file-change', path, event: 'create' });
  }

  async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
    this.ensureBooted();
    await this.state.instance!.fs.rm(path, options);
    this.emit({ type: 'file-change', path, event: 'delete' });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.state.instance!.fs.readFile(path);
      return true;
    } catch {
      try {
        await this.state.instance!.fs.readdir(path);
        return true;
      } catch {
        return false;
      }
    }
  }

  // ============================================
  // MOUNT FILE TREE
  // ============================================

  async mount(tree: FileSystemTree): Promise<void> {
    this.ensureBooted();
    await this.state.instance!.mount(tree);
  }

  async mountFromVirtualFS(nodes: VirtualNode[]): Promise<void> {
    const tree = this.convertToFileSystemTree(nodes);
    await this.mount(tree);
  }

  private convertToFileSystemTree(nodes: VirtualNode[]): FileSystemTree {
    const tree: FileSystemTree = {};

    for (const node of nodes) {
      if (node.type === 'file') {
        tree[node.name] = {
          file: { contents: node.content },
        };
      } else {
        tree[node.name] = {
          directory: this.convertToFileSystemTree(node.children),
        };
      }
    }

    return tree;
  }

  // ============================================
  // PROCESS MANAGEMENT
  // ============================================

  async spawn(
    command: string,
    args: string[] = [],
    options: SpawnOptions = {}
  ): Promise<string> {
    this.ensureBooted();

    const processId = `proc_${++this.processCounter}`;
    const cwd = options.cwd || '/';

    const process = await this.state.instance!.spawn(command, args, {
      cwd,
      env: options.env,
      terminal: options.terminal,
    });

    const processInfo: ProcessInfo = {
      id: processId,
      command,
      args,
      cwd,
      startTime: Date.now(),
      status: 'running',
    };

    this.state.processes.set(processId, processInfo);
    // keep a handle to the actual webcontainer process for kill/resize
    this.processHandles.set(processId, process);
    this.emit({ type: 'process-start', processId, command: `${command} ${args.join(' ')}` });

    // Handle output
    this.handleProcessOutput(processId, process);

    // Register with process monitor (if timeout provided)
    try {
      const timeout = options.timeoutMs ?? 0;
      if (timeout && timeout > 0) {
        this.processMonitor.register(processId, process as any, timeout, (id) => {
          this.emit({ type: 'error', message: `Process ${id} timed out and was killed` });
        });
      }
    } catch {}

    // Handle exit
    process.exit.then(exitCode => {
      const info = this.state.processes.get(processId);
      if (info) {
        info.status = 'exited';
        info.exitCode = exitCode;
      }
      try { this.processMonitor.unregister(processId); } catch {}
      if (this.processHandles.has(processId)) this.processHandles.delete(processId);
      this.emit({ type: 'process-exit', processId, exitCode });
    });

    return processId;
  }

  private async handleProcessOutput(
    processId: string,
    process: WebContainerProcess
  ): Promise<void> {
    const reader = process.output.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const output: ProcessOutput = {
          type: 'stdout',
          data: value,
          timestamp: Date.now(),
        };

        this.emit({ type: 'process-output', processId, output });
      }
    } catch (error) {
      // Process ended
    } finally {
      reader.releaseLock();
    }
  }

  async killProcess(processId: string): Promise<void> {
    const info = this.state.processes.get(processId);
    const handle = this.processHandles.get(processId);
    if (handle && typeof (handle as any).kill === 'function') {
      try {
        (handle as any).kill();
      } catch {
        // ignore
      }
    }

    if (info) {
      info.status = 'exited';
      info.exitCode = -1;
      this.state.processes.delete(processId);
    }

    if (this.processHandles.has(processId)) {
      this.processHandles.delete(processId);
    }
  }

  getProcess(processId: string): ProcessInfo | undefined {
    return this.state.processes.get(processId);
  }

  getRunningProcesses(): ProcessInfo[] {
    return Array.from(this.state.processes.values()).filter(
      p => p.status === 'running'
    );
  }

  // ============================================
  // TERMINAL SESSIONS
  // ============================================

  async createTerminalSession(
    options: { cols?: number; rows?: number } = {}
  ): Promise<string> {
    this.ensureBooted();

    const sessionId = `term_${++this.sessionCounter}`;
    const { cols = 80, rows = 24 } = options;

    const process = await this.state.instance!.spawn('jsh', [], {
      terminal: { cols, rows },
    });

    const input = process.input.getWriter();

    const session: TerminalSession = {
      id: sessionId,
      process,
      input,
      output: process.output,
    };

    this.state.terminalSessions.set(sessionId, session);
    return sessionId;
  }

  async writeToTerminal(sessionId: string, data: string): Promise<void> {
    const session = this.state.terminalSessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session ${sessionId} not found`);
    }
    await session.input.write(data);
  }

  getTerminalOutput(sessionId: string): ReadableStream<string> | undefined {
    const session = this.state.terminalSessions.get(sessionId);
    return session?.output;
  }

  async resizeTerminal(
    sessionId: string,
    cols: number,
    rows: number
  ): Promise<void> {
    const session = this.state.terminalSessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session ${sessionId} not found`);
    }
    session.process.resize({ cols, rows });
  }

  async closeTerminalSession(sessionId: string): Promise<void> {
    const session = this.state.terminalSessions.get(sessionId);
    if (session) {
      await session.input.close();
      session.process.kill();
      this.state.terminalSessions.delete(sessionId);
    }
  }

  // ============================================
  // PACKAGE MANAGEMENT
  // ============================================
  private async performInstall(packages: string[], timeoutMs: number): Promise<{ success: boolean; output: string }> {
    const output: string[] = [];
    const processId = await this.spawn('npm', ['install', ...packages], { timeoutMs });

    return new Promise(resolve => {
      let resolved = false;
      const handler = (event: WebContainerEvent) => {
        if (event.type === 'process-output' && event.processId === processId) {
          output.push(event.output.data);
        }
        if (event.type === 'process-exit' && event.processId === processId) {
          if (resolved) return;
          resolved = true;
          this.removeEventHandler(handler);
          resolve({
            success: event.exitCode === 0,
            output: output.join(''),
          });
        }
      };

      const timeoutId = setTimeout(async () => {
        if (resolved) return;
        resolved = true;
        try {
          await this.killProcess(processId);
        } catch {}
        this.removeEventHandler(handler);
        resolve({ success: false, output: output.join('') + '\n[timeout]' });
      }, timeoutMs);

      this.addEventHandler(handler);
    });
  }

  async installPackages(packages: string[], retries = 1): Promise<{ success: boolean; output: string }> {
    this.ensureBooted();

    const key = packages.join(',');
    const cache = this.packageCache.get(key);
    const cacheTTL = 1000 * 60 * 60; // 1 hour
    if (cache && Date.now() - cache.timestamp < cacheTTL) {
      return { success: cache.success, output: cache.output + '\n[cached]' };
    }

    const timeoutMs = this.options.packageInstallTimeout ?? 120000;
    let last: { success: boolean; output: string } = { success: false, output: '' };
    for (let attempt = 0; attempt <= retries; attempt++) {
      last = await this.performInstall(packages, timeoutMs);
      if (last.success) break;
    }

    this.packageCache.set(key, { success: last.success, timestamp: Date.now(), output: last.output });
    return last;
  }

  async runNpmScript(script: string): Promise<{ success: boolean; output: string }> {
    this.ensureBooted();

    const output: string[] = [];
    const processId = await this.spawn('npm', ['run', script]);

    return new Promise(resolve => {
      const handler = (event: WebContainerEvent) => {
        if (event.type === 'process-output' && event.processId === processId) {
          output.push(event.output.data);
        }
        if (event.type === 'process-exit' && event.processId === processId) {
          this.removeEventHandler(handler);
          resolve({
            success: event.exitCode === 0,
            output: output.join(''),
          });
        }
      };
      this.addEventHandler(handler);
    });
  }

  // ============================================
  // SERVER MANAGEMENT
  // ============================================

  getServer(port: number): ServerInfo | undefined {
    return this.state.servers.get(port);
  }

  getServers(): ServerInfo[] {
    return Array.from(this.state.servers.values());
  }

  async waitForServer(port: number, timeout = 30000): Promise<ServerInfo | null> {
    const existing = this.state.servers.get(port);
    if (existing?.ready) {
      return existing;
    }

    return new Promise(resolve => {
      const timeoutId = setTimeout(() => {
        this.removeEventHandler(handler);
        resolve(null);
      }, timeout);

      const handler = (event: WebContainerEvent) => {
        if (event.type === 'server-ready' && event.port === port) {
          clearTimeout(timeoutId);
          this.removeEventHandler(handler);
          resolve({ port: event.port, url: event.url, ready: true });
        }
      };

      this.addEventHandler(handler);
    });
  }

  // ============================================
  // EVENT HANDLING
  // ============================================

  addEventHandler(handler: WebContainerEventHandler): void {
    this.eventHandlers.add(handler);
  }

  removeEventHandler(handler: WebContainerEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emit(event: WebContainerEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Event handler error:', error);
      }
    }
  }

  // ============================================
  // UTILITIES
  // ============================================

  private ensureBooted(): void {
    if (!this.state.booted || !this.state.instance) {
      throw new Error('WebContainer is not booted. Call boot() first.');
    }
  }

  getWebContainer(): WebContainer | null {
    return this.state.instance;
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createWebContainerRuntime(
  options?: WebContainerRuntimeOptions
): WebContainerRuntime {
  return WebContainerRuntime.getInstance(options);
}
