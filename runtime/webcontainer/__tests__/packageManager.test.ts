import { describe, it, expect, vi } from 'vitest';
import { safeInstall } from '../packageManager';

describe('packageManager.safeInstall', () => {
  it('returns success when runtime.installPackages succeeds', async () => {
    const runtime: any = { installPackages: vi.fn().mockResolvedValue({ success: true, output: 'ok' }) };
    const res = await safeInstall(runtime, ['lodash'], 0);
    expect(res.success).toBe(true);
  });

  it('retries on failure and returns last result', async () => {
    const runtime: any = { installPackages: vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ success: true, output: 'ok' }) };

    const res = await safeInstall(runtime, ['pkg'], 1);
    expect(res.success).toBe(true);
    expect(runtime.installPackages).toHaveBeenCalledTimes(2);
  });
});
