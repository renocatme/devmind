import { expect, test, vi } from 'vitest';
import { GeminiProvider } from '../providers/gemini';

test('GeminiProvider constructor throws without apiKey', () => {
  expect(() => new GeminiProvider({ name: 'gemini' as const }, undefined, false)).toThrow();
});

test('GeminiProvider.chat parses response', async () => {
  // Mock global fetch
  const mockJson = {
    candidates: [
      {
        content: { parts: [{ text: 'Hello from Gemini' }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
  };

  const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockJson) } as any));
  // @ts-ignore - assign global
  globalThis.fetch = fetchMock;

  const provider = new GeminiProvider({ name: 'gemini' as const, apiKey: 'test-key' }, undefined, false);

  const res = await provider.chat({ messages: [{ role: 'user', content: 'hi' }], model: 'gemini-2.5-pro' });
  expect(res.content).toContain('Hello from Gemini');
  expect(res.usage.totalTokens).toBe(3);
});
