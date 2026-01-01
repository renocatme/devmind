import { expect, test } from 'vitest';
import { createConfig, createClient } from '../index';

test('LLMClient.executeTools runs tool executors and returns results', async () => {
  const config = createConfig({ ollamaUrl: 'http://localhost:11434' });
  const client = createClient(config);

  const response = {
    id: 'r1',
    model: 'llama3.2',
    content: 'OK',
    toolCalls: [
      { id: 't1', name: 'get_weather', arguments: { location: 'Tokyo' } }
    ],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    finishReason: 'tool_calls',
    provider: 'ollama' as const,
  } as any;

  const tools = [
    {
      name: 'get_weather',
      description: 'Get weather',
      parameters: { type: 'object' } as any,
      execute: async (args: Record<string, unknown>) => `Weather in ${args.location}: Sunny`,
    },
  ];

  const results = await client.executeTools(response, tools as any);
  expect(results.length).toBe(1);
  expect(results[0].result).toContain('Weather in Tokyo');
});
