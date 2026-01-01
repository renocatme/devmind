import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessMonitor } from '../processMonitor';

describe('ProcessMonitor', () => {
  let monitor: ProcessMonitor;

  beforeEach(() => {
    monitor = new ProcessMonitor();
  });

  it('kills handle after timeout', async () => {
    const kill = vi.fn();
    monitor.register('p1', { kill }, 20);
    await new Promise((r) => setTimeout(r, 40));
    expect(kill).toHaveBeenCalled();
  });

  it('unregister prevents kill', async () => {
    const kill = vi.fn();
    monitor.register('p2', { kill }, 40);
    monitor.unregister('p2');
    await new Promise((r) => setTimeout(r, 60));
    expect(kill).not.toHaveBeenCalled();
  });
});
