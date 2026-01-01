import type { WebContainerRuntime } from './WebContainerRuntime';

export function validateCOEP(value?: string): boolean {
  if (!value) return false;
  return value === 'credentialless' || value === 'require-corp';
}

export async function waitForServerReady(runtime: WebContainerRuntime, port: number, timeout = 30000): Promise<boolean> {
  if (!runtime || typeof runtime.waitForServer !== 'function') {
    throw new Error('Invalid runtime');
  }

  const info = await runtime.waitForServer(port, timeout);
  return !!info;
}

export default { validateCOEP, waitForServerReady };
