/**
 * DevMind Multi-Provider LLM SDK - Main Client
 */

import {
  ClientConfig,
  ProviderName,
  LLMProvider,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  ToolDefinition,
  ToolResult,
  ToolContext,
  Message,
  StreamOptions,
} from './types';
import { validateConfig } from './config';
import { LLMError, normalizeError } from './errors';
import { GeminiProvider, OpenAIProvider, AnthropicProvider, OllamaProvider } from './providers';
import { StreamProcessor } from './utils/streaming';
import { CombinedRateLimiter } from './utils/rate-limit';
import { CircuitBreaker } from './utils/retry';

// ============================================
// LLM CLIENT
// ============================================

export class LLMClient {
  private providers: Map<ProviderName, LLMProvider> = new Map();
  private activeProvider: LLMProvider;
  private config: ClientConfig;
  private concurrencyLimit: number;
  private activeRequests = 0;
  private requestQueue: Array<() => void> = [];
  private providerLimiters: Map<ProviderName, CombinedRateLimiter> = new Map();
  private providerCircuitBreakers: Map<ProviderName, CircuitBreaker> = new Map();

  constructor(config: ClientConfig) {
    // Validate configuration
    const errors = validateConfig(config);
    if (errors.length > 0) {
      throw new Error(`Invalid configuration: ${errors.join(', ')}`);
    }

    this.config = config;
    // Concurrency limit can be provided via config.concurrencyLimit (optional)
    // without changing the public ClientConfig type.
    this.concurrencyLimit = (config as any).concurrencyLimit || 5;
    this.initializeProviders();
    
    // Set default provider
    const defaultProvider = this.providers.get(config.defaultProvider);
    if (!defaultProvider) {
      throw new Error(`Default provider '${config.defaultProvider}' not found`);
    }
    this.activeProvider = defaultProvider;
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  private initializeProviders(): void {
    for (const providerConfig of this.config.providers) {
      try {
        let provider: LLMProvider;

        switch (providerConfig.name) {
          case 'gemini':
            provider = new GeminiProvider(
              providerConfig,
              this.config.retryConfig,
              this.config.debug
            );
            break;
          case 'openai':
            provider = new OpenAIProvider(
              providerConfig,
              this.config.retryConfig,
              this.config.debug
            );
            break;
          case 'anthropic':
            provider = new AnthropicProvider(
              providerConfig,
              this.config.retryConfig,
              this.config.debug
            );
            break;
          case 'ollama':
            provider = new OllamaProvider(
              providerConfig,
              this.config.retryConfig,
              this.config.debug
            );
            break;
          default:
            console.warn(`Unknown provider: ${providerConfig.name}`);
            continue;
        }

        this.providers.set(providerConfig.name, provider);
        // Initialize per-provider rate limiters if configured
        if (providerConfig.rateLimit) {
          this.providerLimiters.set(
            providerConfig.name,
            new CombinedRateLimiter(providerConfig.rateLimit)
          );
        }
        // Initialize circuit breaker per provider (defaults)
        this.providerCircuitBreakers.set(
          providerConfig.name,
          new CircuitBreaker(
            (providerConfig as any).circuitBreaker?.failureThreshold || 5,
            (providerConfig as any).circuitBreaker?.resetTimeoutMs || 60000
          )
        );
      } catch (error) {
        console.error(`Failed to initialize provider ${providerConfig.name}:`, error);
      }
    }
  }

  // SIMPLE SEMAPHORE FOR CONCURRENCY CONTROL
  private async acquireSlot(): Promise<void> {
    if (this.activeRequests < this.concurrencyLimit) {
      this.activeRequests++;
      return;
    }

    await new Promise<void>(resolve => this.requestQueue.push(resolve));
    this.activeRequests++;
  }

  private releaseSlot(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    const next = this.requestQueue.shift();
    if (next) next();
  }

  // ============================================
  // PROVIDER MANAGEMENT
  // ============================================

  setProvider(name: ProviderName): void {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Provider '${name}' is not configured`);
    }
    this.activeProvider = provider;
  }

  getProvider(name?: ProviderName): LLMProvider {
    if (name) {
      const provider = this.providers.get(name);
      if (!provider) {
        throw new Error(`Provider '${name}' is not configured`);
      }
      return provider;
    }
    return this.activeProvider;
  }

  getActiveProviderName(): ProviderName {
    return this.activeProvider.name;
  }

  getAvailableProviders(): ProviderName[] {
    return Array.from(this.providers.keys());
  }

  hasProvider(name: ProviderName): boolean {
    return this.providers.has(name);
  }

  // ============================================
  // CHAT METHODS
  // ============================================

  async chat(request: ChatRequest): Promise<ChatResponse> {
    await this.acquireSlot();
    try {
      const limiter = this.providerLimiters.get(this.getActiveProviderName());
      if (limiter) await limiter.acquire(request.maxTokens);
      const cb = this.providerCircuitBreakers.get(this.getActiveProviderName());
      if (cb) {
        return await cb.execute(() => this.activeProvider.chat(request));
      }
      return await this.activeProvider.chat(request);
    } finally {
      this.releaseSlot();
    }
  }

  async chatWith(provider: ProviderName, request: ChatRequest): Promise<ChatResponse> {
    await this.acquireSlot();
    try {
      const p = this.getProvider(provider);
      const limiter = this.providerLimiters.get(provider);
      if (limiter) await limiter.acquire(request.maxTokens);
      const cb = this.providerCircuitBreakers.get(provider);
      if (cb) {
        return await cb.execute(() => p.chat(request));
      }
      return await p.chat(request);
    } finally {
      this.releaseSlot();
    }
  }

  // ============================================
  // STREAMING METHODS
  // ============================================

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    await this.acquireSlot();
    try {
      const limiter = this.providerLimiters.get(this.getActiveProviderName());
      if (limiter) await limiter.acquire(request.maxTokens);
      const cb = this.providerCircuitBreakers.get(this.getActiveProviderName());
      // For streaming, avoid wrapping generator in circuit breaker; rely on rate limiter and concurrency
      yield* this.activeProvider.stream(request);
    } finally {
      this.releaseSlot();
    }
  }

  async *streamWith(
    provider: ProviderName,
    request: ChatRequest
  ): AsyncGenerator<StreamChunk> {
    await this.acquireSlot();
    try {
      const limiter = this.providerLimiters.get(provider);
      if (limiter) await limiter.acquire(request.maxTokens);
      // For streaming, avoid wrapping generator in circuit breaker; rely on rate limiter and concurrency
      yield* this.getProvider(provider).stream(request);
    } finally {
      this.releaseSlot();
    }
  }

  async streamWithCallbacks(
    request: ChatRequest,
    options: StreamOptions
  ): Promise<ChatResponse> {
    const processor = new StreamProcessor(options);
    try {
      for await (const chunk of this.stream(request)) {
        if (options.signal?.aborted) {
          break;
        }
        processor.processChunk(chunk);
      }

      return {
        id: `stream_${Date.now()}`,
        model: request.model || '',
        content: processor.getText(),
        toolCalls: processor.getToolCalls().length > 0 ? processor.getToolCalls() : undefined,
        usage: processor.getUsage() || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'stop',
        thinking: processor.getThinking() || undefined,
        provider: this.activeProvider.name,
      };
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  // ============================================
  // TOOL EXECUTION
  // ============================================

  async executeTools(
    response: ChatResponse,
    tools: ToolDefinition[],
    context?: ToolContext
  ): Promise<ToolResult[]> {
    if (!response.toolCalls?.length) {
      return [];
    }

    const results: ToolResult[] = [];

    for (const call of response.toolCalls) {
      const tool = tools.find(t => t.name === call.name);
      
      if (!tool?.execute) {
        results.push({
          toolCallId: call.id,
          result: `Error: Tool '${call.name}' not found or has no executor`,
          isError: true,
        });
        continue;
      }

      try {
        const result = await tool.execute(call.arguments, context);
        results.push({
          toolCallId: call.id,
          result,
        });
      } catch (error) {
        results.push({
          toolCallId: call.id,
          result: `Error: ${error instanceof Error ? error.message : String(error)}`,
          isError: true,
        });
      }
    }

    return results;
  }

  // ============================================
  // AGENTIC LOOP
  // ============================================

  async runAgentLoop(
    request: ChatRequest,
    tools: ToolDefinition[],
    options: {
      maxIterations?: number;
      context?: ToolContext;
      onToolCall?: (name: string, args: Record<string, unknown>) => void;
      onToolResult?: (name: string, result: string) => void;
      onIteration?: (iteration: number, response: ChatResponse) => void;
    } = {}
  ): Promise<ChatResponse> {
    const { maxIterations = 10, context, onToolCall, onToolResult, onIteration } = options;
    
    let messages = [...request.messages];
    let iterations = 0;
    let lastResponse: ChatResponse | null = null;

    while (iterations < maxIterations) {
      const response = await this.chat({
        ...request,
        messages,
        tools,
      });

      lastResponse = response;
      onIteration?.(iterations, response);

      // No tool calls - we're done
      if (!response.toolCalls?.length) {
        return response;
      }

      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      // Execute tools and add results
      for (const call of response.toolCalls) {
        onToolCall?.(call.name, call.arguments);
        
        const tool = tools.find(t => t.name === call.name);
        let result = `Error: Tool '${call.name}' not found`;

        if (tool?.execute) {
          try {
            result = await tool.execute(call.arguments, context);
          } catch (error) {
            result = `Error: ${error instanceof Error ? error.message : String(error)}`;
          }
        }

        onToolResult?.(call.name, result);

        messages.push({
          role: 'tool',
          content: result,
          toolCallId: call.id,
          name: call.name,
        });
      }

      iterations++;
    }

    // Max iterations reached
    if (lastResponse) {
      return {
        ...lastResponse,
        content: lastResponse.content + '\n\n[Max iterations reached]',
      };
    }

    throw new Error('Agent loop failed to produce a response');
  }

  // ============================================
  // STREAMING AGENT LOOP
  // ============================================

  async *runAgentLoopStreaming(
    request: ChatRequest,
    tools: ToolDefinition[],
    options: {
      maxIterations?: number;
      context?: ToolContext;
    } = {}
  ): AsyncGenerator<{
    type: 'text' | 'tool_call' | 'tool_result' | 'done';
    content?: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolResult?: string;
  }> {
    const { maxIterations = 10, context } = options;
    
    let messages = [...request.messages];
    let iterations = 0;

    while (iterations < maxIterations) {
      let currentText = '';
      const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

      // Stream the response
      for await (const chunk of this.stream({ ...request, messages, tools })) {
        if (chunk.type === 'text' && chunk.content) {
          currentText += chunk.content;
          yield { type: 'text', content: chunk.content };
        }

        if (chunk.type === 'tool_call' && chunk.toolCall) {
          const tc = chunk.toolCall;
          if (tc.id && tc.name && tc.arguments) {
            toolCalls.push({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            });
            yield {
              type: 'tool_call',
              toolName: tc.name,
              toolArgs: tc.arguments,
            };
          }
        }
      }

      // No tool calls - we're done
      if (toolCalls.length === 0) {
        yield { type: 'done' };
        return;
      }

      // Add assistant message
      messages.push({
        role: 'assistant',
        content: currentText,
        toolCalls,
      });

      // Execute tools
      for (const call of toolCalls) {
        const tool = tools.find(t => t.name === call.name);
        let result = `Error: Tool '${call.name}' not found`;

        if (tool?.execute) {
          try {
            result = await tool.execute(call.arguments, context);
          } catch (error) {
            result = `Error: ${error instanceof Error ? error.message : String(error)}`;
          }
        }

        yield {
          type: 'tool_result',
          toolName: call.name,
          toolResult: result,
        };

        messages.push({
          role: 'tool',
          content: result,
          toolCallId: call.id,
          name: call.name,
        });
      }

      iterations++;
    }

    yield { type: 'done' };
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  async countTokens(text: string, model?: string): Promise<number> {
    if (this.activeProvider.countTokens) {
      return this.activeProvider.countTokens(text, model);
    }
    // Fallback estimation
    return Math.ceil(text.length / 4);
  }

  async validateApiKey(provider?: ProviderName): Promise<boolean> {
    const p = provider ? this.getProvider(provider) : this.activeProvider;
    if (p.validateApiKey) {
      return p.validateApiKey();
    }
    return true;
  }

  getModels(provider?: ProviderName) {
    const p = provider ? this.getProvider(provider) : this.activeProvider;
    return p.models;
  }

  // ============================================
  // CONVENIENCE METHODS
  // ============================================

  async ask(prompt: string, options?: Partial<ChatRequest>): Promise<string> {
    const response = await this.chat({
      messages: [{ role: 'user', content: prompt }],
      ...options,
    });
    return response.content;
  }

  async askWithSystem(
    systemPrompt: string,
    userPrompt: string,
    options?: Partial<ChatRequest>
  ): Promise<string> {
    const response = await this.chat({
      messages: [{ role: 'user', content: userPrompt }],
      systemPrompt,
      ...options,
    });
    return response.content;
  }

  async complete(
    messages: Message[],
    options?: Partial<ChatRequest>
  ): Promise<ChatResponse> {
    return this.chat({ messages, ...options });
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

export function createClient(config: ClientConfig): LLMClient {
  return new LLMClient(config);
}
