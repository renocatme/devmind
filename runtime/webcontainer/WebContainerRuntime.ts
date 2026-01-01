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
      this.state.instance = await WebContainer.boot({
        workdirName: this.options.workdirName || 'workspace',
        coep: this.options.coep || 'credentialless',
      });

      // Listen for server-ready events
      this.state.instance.on('server-ready', (port, url) => {
        this.state.servers.set(port, { port, url, ready: true });
        this.emit({ type: 'server-ready', port, url });
      });

      this.state.booted = true;
      this.emit({ type: 'boot', success: true });
      return true;
    } catch (error) {
      this.emit({ type: 'error', message: `Boot failed: ${error}` });
      this.emit({ type: 'boot', success: false });
      return false;
    }
  }

  async teardown(): Promise<void> {
    // Kill all processes
    for (const [id] of this.state.processes) {
      await this.killProcess(id);
    }

    // Close all terminal sessions
    for (const [id] of this.state.terminalSessions) {
      await this.closeTerminalSession(id);
    }

    this.state = {
      booted: false,
      instance: null,
      processes: new Map(),
      servers: new Map(),
      terminalSessions: new Map(),
    };
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
    this.emit({ type: 'process-start', processId, command: `${command} ${args.join(' ')}` });

    // Handle output
    this.handleProcessOutput(processId, process);

    // Handle exit
    process.exit.then(exitCode => {
      const info = this.state.processes.get(processId);
      if (info) {
        info.status = 'exited';
        info.exitCode = exitCode;
      }
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
    if (info) {
      info.status = 'exited';
      info.exitCode = -1;
      this.state.processes.delete(processId);
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

  async installPackages(packages: string[]): Promise<{ success: boolean; output: string }> {
    this.ensureBooted();

    const output: string[] = [];
    const processId = await this.spawn('npm', ['install', ...packages]);

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
