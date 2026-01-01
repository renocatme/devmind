/**
 * React Hook for WebContainer Runtime
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { WebContainerRuntime, createWebContainerRuntime } from './WebContainerRuntime';
import {
  WebContainerEvent,
  ProcessInfo,
  ServerInfo,
  VirtualNode,
} from './types';

// ============================================
// HOOK STATE
// ============================================

interface WebContainerState {
  booted: boolean;
  booting: boolean;
  error: string | null;
  processes: ProcessInfo[];
  servers: ServerInfo[];
  terminalSessionId: string | null;
}

interface WebContainerActions {
  boot: () => Promise<boolean>;
  writeFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  readDir: (path: string) => Promise<string[]>;
  mkdir: (path: string) => Promise<void>;
  rm: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  spawn: (command: string, args?: string[]) => Promise<string>;
  killProcess: (processId: string) => Promise<void>;
  installPackages: (packages: string[]) => Promise<{ success: boolean; output: string }>;
  runNpmScript: (script: string) => Promise<{ success: boolean; output: string }>;
  createTerminal: () => Promise<string>;
  writeToTerminal: (data: string) => Promise<void>;
  closeTerminal: () => Promise<void>;
  mountFiles: (nodes: VirtualNode[]) => Promise<void>;
}

// ============================================
// HOOK IMPLEMENTATION
// ============================================

export function useWebContainer(
  onOutput?: (data: string) => void,
  onServerReady?: (port: number, url: string) => void
): WebContainerState & WebContainerActions {
  const [state, setState] = useState<WebContainerState>({
    booted: false,
    booting: false,
    error: null,
    processes: [],
    servers: [],
    terminalSessionId: null,
  });

  const runtimeRef = useRef<WebContainerRuntime | null>(null);
  const outputCallbackRef = useRef(onOutput);
  const serverCallbackRef = useRef(onServerReady);

  // Update refs when callbacks change
  useEffect(() => {
    outputCallbackRef.current = onOutput;
    serverCallbackRef.current = onServerReady;
  }, [onOutput, onServerReady]);

  // Event handler
  const handleEvent = useCallback((event: WebContainerEvent) => {
    switch (event.type) {
      case 'boot':
        setState(s => ({ ...s, booted: event.success, booting: false }));
        break;

      case 'process-start':
        setState(s => ({
          ...s,
          processes: [
            ...s.processes,
            {
              id: event.processId,
              command: event.command,
              args: [],
              cwd: '/',
              startTime: Date.now(),
              status: 'running',
            },
          ],
        }));
        break;

      case 'process-exit':
        setState(s => ({
          ...s,
          processes: s.processes.map(p =>
            p.id === event.processId
              ? { ...p, status: 'exited' as const, exitCode: event.exitCode }
              : p
          ),
        }));
        break;

      case 'process-output':
        outputCallbackRef.current?.(event.output.data);
        break;

      case 'server-ready':
        setState(s => ({
          ...s,
          servers: [...s.servers, { port: event.port, url: event.url, ready: true }],
        }));
        serverCallbackRef.current?.(event.port, event.url);
        break;

      case 'error':
        setState(s => ({ ...s, error: event.message }));
        break;
    }
  }, []);

  // Initialize runtime
  useEffect(() => {
    runtimeRef.current = createWebContainerRuntime({ onEvent: handleEvent });

    return () => {
      // Cleanup on unmount
      if (state.terminalSessionId && runtimeRef.current) {
        runtimeRef.current.closeTerminalSession(state.terminalSessionId);
      }
    };
  }, [handleEvent]);

  // Actions
  const boot = useCallback(async (): Promise<boolean> => {
    if (!runtimeRef.current) return false;
    
    setState(s => ({ ...s, booting: true, error: null }));
    
    try {
      const success = await runtimeRef.current.boot();
      return success;
    } catch (error) {
      setState(s => ({
        ...s,
        booting: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      return false;
    }
  }, []);

  const writeFile = useCallback(async (path: string, content: string): Promise<void> => {
    if (!runtimeRef.current?.isBooted()) {
      throw new Error('WebContainer not booted');
    }
    await runtimeRef.current.writeFile(path, content);
  }, []);

  const readFile = useCallback(async (path: string): Promise<string> => {
    if (!runtimeRef.current?.isBooted()) {
      throw new Error('WebContainer not booted');
    }
    return await runtimeRef.current.readFile(path);
  }, []);

  const readDir = useCallback(async (path: string): Promise<string[]> => {
    if (!runtimeRef.current?.isBooted()) {
      throw new Error('WebContainer not booted');
    }
    return await runtimeRef.current.readDir(path);
  }, []);

  const mkdir = useCallback(async (path: string): Promise<void> => {
    if (!runtimeRef.current?.isBooted()) {
      throw new Error('WebContainer not booted');
    }
    await runtimeRef.current.mkdir(path);
  }, []);

  const rm = useCallback(async (path: string, options?: { recursive?: boolean }): Promise<void> => {
    if (!runtimeRef.current?.isBooted()) {
      throw new Error('WebContainer not booted');
    }
    await runtimeRef.current.rm(path, options);
  }, []);

  const spawn = useCallback(async (command: string, args: string[] = []): Promise<string> => {
    if (!runtimeRef.current?.isBooted()) {
      throw new Error('WebContainer not booted');
    }
    return await runtimeRef.current.spawn(command, args);
  }, []);

  const killProcess = useCallback(async (processId: string): Promise<void> => {
    if (!runtimeRef.current) return;
    await runtimeRef.current.killProcess(processId);
    setState(s => ({
      ...s,
      processes: s.processes.filter(p => p.id !== processId),
    }));
  }, []);

  const installPackages = useCallback(async (packages: string[]): Promise<{ success: boolean; output: string }> => {
    if (!runtimeRef.current?.isBooted()) {
      throw new Error('WebContainer not booted');
    }
    return await runtimeRef.current.installPackages(packages);
  }, []);

  const runNpmScript = useCallback(async (script: string): Promise<{ success: boolean; output: string }> => {
    if (!runtimeRef.current?.isBooted()) {
      throw new Error('WebContainer not booted');
    }
    return await runtimeRef.current.runNpmScript(script);
  }, []);

  const createTerminal = useCallback(async (): Promise<string> => {
    if (!runtimeRef.current?.isBooted()) {
      throw new Error('WebContainer not booted');
    }
    
    // Close existing terminal if any
    if (state.terminalSessionId) {
      await runtimeRef.current.closeTerminalSession(state.terminalSessionId);
    }
    
    const sessionId = await runtimeRef.current.createTerminalSession();
    setState(s => ({ ...s, terminalSessionId: sessionId }));
    
    // Start reading output
    const output = runtimeRef.current.getTerminalOutput(sessionId);
    if (output) {
      const reader = output.getReader();
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            outputCallbackRef.current?.(value);
          }
        } catch {
          // Terminal closed
        }
      })();
    }
    
    return sessionId;
  }, [state.terminalSessionId]);

  const writeToTerminal = useCallback(async (data: string): Promise<void> => {
    if (!runtimeRef.current || !state.terminalSessionId) {
      throw new Error('No terminal session');
    }
    await runtimeRef.current.writeToTerminal(state.terminalSessionId, data);
  }, [state.terminalSessionId]);

  const closeTerminal = useCallback(async (): Promise<void> => {
    if (!runtimeRef.current || !state.terminalSessionId) return;
    await runtimeRef.current.closeTerminalSession(state.terminalSessionId);
    setState(s => ({ ...s, terminalSessionId: null }));
  }, [state.terminalSessionId]);

  const mountFiles = useCallback(async (nodes: VirtualNode[]): Promise<void> => {
    if (!runtimeRef.current?.isBooted()) {
      throw new Error('WebContainer not booted');
    }
    await runtimeRef.current.mountFromVirtualFS(nodes);
  }, []);

  return {
    ...state,
    boot,
    writeFile,
    readFile,
    readDir,
    mkdir,
    rm,
    spawn,
    killProcess,
    installPackages,
    runNpmScript,
    createTerminal,
    writeToTerminal,
    closeTerminal,
    mountFiles,
  };
}
