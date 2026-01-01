import { expect, test } from 'vitest';
import { createConfig, createClient } from '../index';

test('LLMClient initializes with Ollama provider when provided', () => {
  const config = createConfig({ ollamaUrl: 'http://localhost:11434' });
  const client = createClient(config);

  expect(client.getAvailableProviders()).toContain('ollama');
  expect(client.getActiveProviderName()).toBe('ollama');
});
