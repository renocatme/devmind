import { expect, test, vi } from 'vitest';
import { OpenAIProvider } from '../providers/openai';
import * as streaming from '../utils/streaming';

function asyncGen(items: any[]) {
  return (async function* () {
    for (const it of items) {
      yield it;
    }
  })();
}

test('OpenAIProvider.stream yields text and usage from parseSSE', async () => {
  const seq = [
    { choices: [{ delta: { content: 'Hello ' } }] },
    { choices: [{ delta: { content: 'world' } }] },
    { usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } },
  ];

  const spy = vi.spyOn(streaming, 'parseSSE').mockImplementation(() => asyncGen(seq) as any);

  const fetchMock = vi.spyOn(globalThis as any, 'fetch').mockResolvedValue({ ok: true } as any);

  const provider = new OpenAIProvider({ name: 'openai' as const, apiKey: 'x' }, undefined, false);

  const chunks: any[] = [];
  for await (const c of provider.stream({ messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o' })) {
    chunks.push(c);
  }

  expect(chunks.some(ch => ch.type === 'text' && ch.content?.includes('Hello'))).toBe(true);
  expect(chunks.some(ch => ch.type === 'text' && ch.content?.includes('world'))).toBe(true);
  expect(chunks.some(ch => ch.type === 'usage' && ch.usage?.totalTokens === 3)).toBe(true);

  spy.mockRestore();
  fetchMock.mockRestore();
});
