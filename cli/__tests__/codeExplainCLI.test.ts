import { describe, it, expect, beforeEach } from 'vitest';
import { handleCommand } from '../commandHandler';
import { KnowledgeBase } from '../../knowledge/KnowledgeBase';

describe('code explain CLI flow', () => {
  beforeEach(() => {
    // ensure KB state is fresh for each test
    (handleCommand as any)._kb = new KnowledgeBase();
  });

  it('reads file and returns explanation lines', async () => {
    const mockRuntime = {
      readFile: async (path: string) => {
        if (path === '/src/index.js') return 'export function add(a, b) { return a + b; }';
        throw new Error('not found');
      },
      writeFile: async () => {},
      readDir: async () => []
    } as any;

    const outLines: string[] = [];
    const out = (l: string) => outLines.push(l);

    await handleCommand(mockRuntime, 'code explain /src/index.js', out);

    // should include header and some explanation text
    expect(outLines.length).toBeGreaterThanOrEqual(2);
    expect(outLines[0]).toMatch(/\$ code:explain \/src\/index.js/);
    const explanation = outLines.slice(1).join('\n');
    expect(explanation.length).toBeGreaterThan(10);
  });
});
