import { describe, it, expect, beforeEach } from 'vitest';
import { handleCommand } from '../commandHandler';
import { KnowledgeBase } from '../../knowledge/KnowledgeBase';

describe('code explain LLM flow', () => {
  beforeEach(() => {
    (handleCommand as any)._kb = new KnowledgeBase();
    (handleCommand as any)._llmClient = {
      askWithSystem: async (_system: string, _user: string, _opts?: any) => {
        return 'LLM explanation: This function adds two numbers.';
      }
    } as any;
  });

  it('uses LLM when client is provided', async () => {
    const mockRuntime = {
      readFile: async (path: string) => {
        if (path === '/src/sum.js') return 'export function sum(a,b){return a+b;}';
        throw new Error('not found');
      },
      writeFile: async () => {},
      readDir: async () => []
    } as any;

    const outLines: string[] = [];
    const out = (l: string) => outLines.push(l);

    await handleCommand(mockRuntime, 'code explain /src/sum.js', out);

    expect(outLines[0]).toMatch(/\$ code:explain \/src\/sum.js/);
    const explanation = outLines.slice(1).join('\n');
    expect(explanation).toContain('LLM explanation');
  });
});
