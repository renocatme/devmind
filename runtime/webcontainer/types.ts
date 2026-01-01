/**
 * WebContainer Runtime Types
 */

import type { WebContainer, FileSystemTree, WebContainerProcess } from '@webcontainer/api';

// ============================================
// FILE SYSTEM TYPES
// ============================================

export interface VirtualFile {
  type: 'file';
  name: string;
  content: string;
}

export interface VirtualDirectory {
  type: 'directory';
  name: string;
  children: VirtualNode[];
}

export type VirtualNode = VirtualFile | VirtualDirectory;

// ============================================
// PROCESS TYPES
// ============================================

export interface ProcessInfo {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  startTime: number;
  status: 'running' | 'exited' | 'error';
  exitCode?: number;
}

export interface ProcessOutput {
  type: 'stdout' | 'stderr';
  data: string;
  timestamp: number;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  terminal?: {
    cols: number;
    rows: number;
  };
  timeoutMs?: number;
}

// ============================================
// TERMINAL TYPES
// ============================================

export interface TerminalSession {
  id: string;
  process: WebContainerProcess;
  input: WritableStreamDefaultWriter<string>;
  output: ReadableStream<string>;
}

// ============================================
// SERVER TYPES
// ============================================

export interface ServerInfo {
  port: number;
  url: string;
  ready: boolean;
}

// ============================================
// RUNTIME STATE
// ============================================

export interface WebContainerState {
  booted: boolean;
  instance: WebContainer | null;
  processes: Map<string, ProcessInfo>;
  servers: Map<number, ServerInfo>;
  terminalSessions: Map<string, TerminalSession>;
}

// ============================================
// EVENT TYPES
// ============================================

export type WebContainerEvent =
  | { type: 'boot'; success: boolean }
  | { type: 'process-start'; processId: string; command: string }
  | { type: 'process-exit'; processId: string; exitCode: number }
  | { type: 'process-output'; processId: string; output: ProcessOutput }
  | { type: 'server-ready'; port: number; url: string }
  | { type: 'file-change'; path: string; event: 'create' | 'change' | 'delete' }
  | { type: 'error'; message: string };

export type WebContainerEventHandler = (event: WebContainerEvent) => void;

// ============================================
// RUNTIME OPTIONS
// ============================================

export interface WebContainerRuntimeOptions {
  workdirName?: string;
  coep?: 'require-corp' | 'credentialless';
  onEvent?: WebContainerEventHandler;
  bootTimeout?: number;
  packageInstallTimeout?: number;
}
