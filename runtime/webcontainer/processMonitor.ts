/**
 * Lightweight process monitor for WebContainer processes.
 * Tracks registered processes and auto-kills them if they exceed timeout.
 */

type Killable = { kill?: () => void };

export class ProcessMonitor {
  private timers = new Map<string, NodeJS.Timeout>();

  register(id: string, handle: Killable, timeoutMs: number, onTimeout?: (id: string) => void) {
    this.unregister(id);
    if (!timeoutMs || timeoutMs <= 0) return;

    const t = setTimeout(() => {
      try {
        handle.kill && handle.kill();
      } catch {}
      onTimeout && onTimeout(id);
    }, timeoutMs);

    this.timers.set(id, t);
  }

  unregister(id: string) {
    const t = this.timers.get(id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(id);
    }
  }

  clearAll() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

export default ProcessMonitor;
