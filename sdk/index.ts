/**
 * DevMind Multi-Provider LLM SDK
 * 
 * A unified interface for multiple LLM providers including:
 * - Google Gemini
 * - OpenAI (GPT-4, o1)
 * - Anthropic (Claude)
 * - Ollama (Local models)
 * 
 * @example
 * ```typescript
 * import { LLMClient, createConfig } from './sdk';
 * 
 * const client = new LLMClient(createConfig({
 *   geminiKey: process.env.GEMINI_API_KEY,
 *   openaiKey: process.env.OPENAI_API_KEY,
 *   defaultProvider: 'gemini',
 * }));
 * 
 * // Simple chat
 * const response = await client.ask('Hello, how are you?');
 * 
 * // Streaming
 * for await (const chunk of client.stream({ messages: [...] })) {
 *   console.log(chunk.content);
 * }
 * 
 * // Agent loop with tools
 * const result = await client.runAgentLoop(request, tools);
 * ```
 */

// Types
export * from './types';

// Errors
export * from './errors';

// Configuration
export {
  ConfigBuilder,
  createConfig,
  createGeminiOnlyConfig,
  createMultiProviderConfig,
  validateConfig,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_RATE_LIMITS,
  DEFAULT_MODELS,
  DEFAULT_TIMEOUTS,
  PROVIDER_BASE_URLS,
  API_KEY_ENV_VARS,
} from './config';

// Client
export { LLMClient, createClient } from './client';

// Providers
export {
  BaseProvider,
  GeminiProvider,
  OpenAIProvider,
  AnthropicProvider,
  OllamaProvider,
} from './providers';

// Utilities
export {
  withRetry,
  withTimeout,
  withRetryAndTimeout,
  sleep,
  CircuitBreaker,
} from './utils/retry';

export {
  RateLimiter,
  SlidingWindowRateLimiter,
  TokenRateLimiter,
  CombinedRateLimiter,
} from './utils/rate-limit';

export {
  StreamProcessor,
  mergeStreams,
  collectStream,
  mapStream,
  filterStream,
  textChunksToStream,
  streamToText,
  parseSSE,
  parseNDJSON,
} from './utils/streaming';
