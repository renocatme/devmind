import { VirtualNode } from './types';
import type { WebContainerRuntime } from './WebContainerRuntime';

// Lightweight File System Bridge utilities for WebContainer runtime

// Cache last mounted tree per runtime to allow diff-based mounts
const lastMountedTree = new WeakMap<any, string>();

function stableSerialize(nodes: VirtualNode[]): string {
  // stable JSON stringify by sorting file/dir names
  function sortNode(n: VirtualNode): any {
    if (n.type === 'file') return { type: 'file', name: n.name, content: n.content };
    return {
      type: 'directory',
      name: n.name,
      children: n.children.map(sortNode).sort((a: any, b: any) => (a.name > b.name ? 1 : -1)),
    };
  }
  const arr = nodes.map(sortNode).sort((a: any, b: any) => (a.name > b.name ? 1 : -1));
  return JSON.stringify(arr);
}

export async function mountVirtualTree(runtime: WebContainerRuntime, nodes: VirtualNode[], skipIfUnchanged = true): Promise<void> {
  if (!runtime || typeof runtime.mountFromVirtualFS !== 'function') {
    throw new Error('Invalid runtime provided');
  }

  if (skipIfUnchanged) {
    try {
      const serialized = stableSerialize(nodes);
      const last = lastMountedTree.get(runtime as any);
      if (last === serialized) return; // no-op
      lastMountedTree.set(runtime as any, serialized);
    } catch {
      // fallthrough to mount
    }
  }

  await runtime.mountFromVirtualFS(nodes);
}

export function watchAndSync(
  runtime: WebContainerRuntime,
  getNodes: () => VirtualNode[],
  interval = 1000
): () => void {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const nodes = getNodes();
      if (nodes && nodes.length) {
        // best-effort sync (use diff to avoid redundant mounts)
        await mountVirtualTree(runtime, nodes, true);
      }
    } catch (e) {
      // swallow — watcher should be resilient
    }
  };

  const id = setInterval(() => void tick(), interval);

  return () => {
    stopped = true;
    clearInterval(id);
  };
}

export default { mountVirtualTree, watchAndSync };
