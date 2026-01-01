import { expect, test, vi } from 'vitest';
import { OpenAIProvider } from '../providers/openai';

test('OpenAIProvider constructor throws without apiKey', () => {
  expect(() => new OpenAIProvider({ name: 'openai' as const }, undefined, false)).toThrow();
});

test('OpenAIProvider.chat parses response', async () => {
  const mockJson = {
    id: '1',
    model: 'gpt-4o',
    choices: [
      { message: { content: 'Hello from OpenAI' }, finish_reason: 'stop' }
    ],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
  };

  const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockJson) } as any));
  // @ts-ignore
  globalThis.fetch = fetchMock;

  const provider = new OpenAIProvider({ name: 'openai' as const, apiKey: 'test-key' }, undefined, false);
  const res = await provider.chat({ messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o' });

  expect(res.content).toContain('Hello from OpenAI');
  expect(res.usage.totalTokens).toBe(3);
});
