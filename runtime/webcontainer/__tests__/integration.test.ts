import { describe, it, expect, vi } from 'vitest';

// Mock @webcontainer/api for integration smoke
vi.mock('@webcontainer/api', () => {
  const mockProcess: any = {
    output: { getReader: () => ({ read: async () => ({ done: true }), releaseLock: () => {} }) },
    input: { getWriter: () => ({ write: vi.fn(), close: vi.fn() }) },
    exit: Promise.resolve(0),
    kill: vi.fn(),
    resize: vi.fn(),
  };

  const mockInstance: any = {
    fs: {
      writeFile: vi.fn(),
      readFile: vi.fn().mockResolvedValue('ok'),
      readdir: vi.fn().mockResolvedValue([]),
      mkdir: vi.fn(),
      rm: vi.fn(),
    },
    spawn: vi.fn().mockResolvedValue(mockProcess),
    on: vi.fn(),
    mount: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
  };

  return {
    WebContainer: {
      boot: vi.fn().mockResolvedValue(mockInstance),
    },
    __mockProcess: mockProcess,
    __mockInstance: mockInstance,
  } as any;
});

import { createWebContainerRuntime } from '../WebContainerRuntime';

describe('Phase 3 integration smoke', () => {
  it('boots, mounts, spawns, installs, and tears down', async () => {
    const runtime = createWebContainerRuntime({ bootTimeout: 1000, packageInstallTimeout: 500 });

    const ok = await runtime.boot();
    expect(ok).toBe(true);

    // mount a small virtual file
    await runtime.mountFromVirtualFS([{ type: 'file', name: 'x.txt', content: 'hello' } as any]);

    const pid = await runtime.spawn('echo', ['hi']);
    expect(pid).toBeDefined();

    const res = await runtime.installPackages(['left-pad'], 0);
    expect(res).toHaveProperty('success');

    await runtime.teardown();
    expect(runtime.isBooted()).toBe(false);
  });
});
