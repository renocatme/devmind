import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@webcontainer/api', () => {
  const mockProcess: any = {
    output: { getReader: () => ({ read: async () => ({ done: true }), releaseLock: () => {} }) },
    input: { getWriter: () => ({ write: vi.fn(), close: vi.fn() }) },
    // never-resolving exit so process appears running for tests
    exit: new Promise(() => {}),
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

import { createWebContainerRuntime, WebContainerRuntime } from '../WebContainerRuntime';
import * as WC from '@webcontainer/api';

describe('WebContainerRuntime', () => {
  beforeEach(async () => {
    // ensure singleton reset
    await (WebContainerRuntime as any).destroy();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await (WebContainerRuntime as any).destroy();
  });

  it('boots with provided options and sets booted state', async () => {
    const runtime = createWebContainerRuntime({ workdirName: 'wd', coep: 'require-corp', bootTimeout: 1000 });
    const ok = await runtime.boot();
    expect(ok).toBe(true);
    expect(runtime.isBooted()).toBe(true);
  });

  it('spawns a process and can kill it', async () => {
    const runtime = createWebContainerRuntime();
    await runtime.boot();

    const id = await runtime.spawn('echo', ['hello']);
    expect(id).toBeDefined();

    const info = runtime.getProcess(id);
    expect(info).toBeDefined();
    expect(info?.status).toBe('running');

    await runtime.killProcess(id);
    expect((WC as any).__mockProcess.kill).toHaveBeenCalled();
    expect(runtime.getProcess(id)).toBeUndefined();
  });

  it('teardown destroys underlying instance and clears state', async () => {
    const runtime = createWebContainerRuntime();
    await runtime.boot();
    await runtime.teardown();

    expect((WC as any).__mockInstance.destroy).toHaveBeenCalled();
    expect(runtime.isBooted()).toBe(false);
  });
});
