import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountVirtualTree, watchAndSync } from '../fsBridge';
import { VirtualFile } from '../types';

describe('fsBridge', () => {
  let mockRuntime: any;

  beforeEach(() => {
    mockRuntime = { mountFromVirtualFS: vi.fn().mockResolvedValue(undefined) };
    vi.clearAllMocks();
  });

  it('mountVirtualTree calls runtime.mountFromVirtualFS', async () => {
    const nodes: VirtualFile[] = [{ type: 'file', name: 'a.txt', content: 'hello' }];
    await mountVirtualTree(mockRuntime, nodes as any);
    expect(mockRuntime.mountFromVirtualFS).toHaveBeenCalledTimes(1);
    expect(mockRuntime.mountFromVirtualFS).toHaveBeenCalledWith(nodes);
  });

  it('mountVirtualTree skips remount when nodes unchanged', async () => {
    const nodes: VirtualFile[] = [{ type: 'file', name: 'a.txt', content: 'hello' }];
    await mountVirtualTree(mockRuntime, nodes as any);
    await mountVirtualTree(mockRuntime, nodes as any);
    expect(mockRuntime.mountFromVirtualFS).toHaveBeenCalledTimes(1);
  });

  it('watchAndSync periodically calls mount and returns a stop function', async () => {
    const spyGet = vi.fn().mockReturnValue([{ type: 'file', name: 'b.txt', content: 'x' }] as any);

    const stop = watchAndSync(mockRuntime, spyGet, 10);

    // wait a bit to allow interval to tick a couple times
    await new Promise((r) => setTimeout(r, 40));

    expect(mockRuntime.mountFromVirtualFS).toHaveBeenCalled();

    stop();
    const calledAfterStop = mockRuntime.mountFromVirtualFS.mock.calls.length;

    // wait to ensure no further calls after stop
    await new Promise((r) => setTimeout(r, 25));
    expect(mockRuntime.mountFromVirtualFS.mock.calls.length).toBe(calledAfterStop);
  });
});
