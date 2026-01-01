import { describe, it, expect, vi } from 'vitest';
import { validateCOEP, waitForServerReady } from '../serverUtils';

describe('serverUtils', () => {
  it('validateCOEP accepts valid values', () => {
    expect(validateCOEP('credentialless')).toBe(true);
    expect(validateCOEP('require-corp')).toBe(true);
    expect(validateCOEP('other')).toBe(false);
  });

  it('waitForServerReady delegates to runtime.waitForServer', async () => {
    const runtime: any = { waitForServer: vi.fn().mockResolvedValue({ port: 3000, url: 'http://x', ready: true }) };
    const ok = await waitForServerReady(runtime, 3000, 10);
    expect(ok).toBe(true);
    expect(runtime.waitForServer).toHaveBeenCalledWith(3000, 10);
  });
});
