/**
 * DevMind Multi-Provider LLM SDK - Base Provider
 */

import {
  LLMProvider,
  ProviderName,
  ProviderConfig,
  ModelInfo,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  Message,
  ToolDefinition,
  RetryConfig,
} from '../types';
import { normalizeError, LLMError } from '../errors';
import { CombinedRateLimiter } from '../utils/rate-limit';
import { withRetry } from '../utils/retry';
import { DEFAULT_RETRY_CONFIG, DEFAULT_RATE_LIMITS } from '../config';

// ============================================
// BASE PROVIDER ABSTRACT CLASS
// ============================================

export abstract class BaseProvider implements LLMProvider {
  abstract readonly name: ProviderName;
  abstract readonly models: ModelInfo[];

  protected config: ProviderConfig;
  protected rateLimiter: CombinedRateLimiter;
  protected retryConfig: RetryConfig;
  protected debug: boolean;

  constructor(config: ProviderConfig, retryConfig?: RetryConfig, debug = false) {
    this.config = config;
    this.retryConfig = retryConfig || DEFAULT_RETRY_CONFIG;
    this.debug = debug;
    
    this.rateLimiter = new CombinedRateLimiter(
      config.rateLimit || DEFAULT_RATE_LIMITS[config.name]
    );
  }

  // ============================================
  // ABSTRACT METHODS (must be implemented)
  // ============================================

  abstract chat(request: ChatRequest): Promise<ChatResponse>;
  abstract stream(request: ChatRequest): AsyncGenerator<StreamChunk>;

  // ============================================
  // PROTECTED HELPERS
  // ============================================

  protected async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, this.retryConfig, (attempt, error, delay) => {
      this.log(`Retry attempt ${attempt} after ${delay}ms: ${error.message}`);
    });
  }

  protected async checkRateLimit(estimatedTokens?: number): Promise<void> {
    await this.rateLimiter.acquire(estimatedTokens);
  }

  protected handleError(error: unknown): never {
    throw normalizeError(error, this.name);
  }

  protected log(...args: unknown[]): void {
    if (this.debug) {
      console.log(`[${this.name}]`, ...args);
    }
  }

  protected getModel(request: ChatRequest): string {
    return request.model || this.config.defaultModel || this.models[0]?.id || '';
  }

  protected getModelInfo(modelId: string): ModelInfo | undefined {
    return this.models.find(m => m.id === modelId);
  }

  // ============================================
  // MESSAGE CONVERSION HELPERS
  // ============================================

  protected extractSystemPrompt(request: ChatRequest): string | undefined {
    // Check for explicit system prompt
    if (request.systemPrompt) {
      return request.systemPrompt;
    }

    // Check for system message in messages array
    const systemMessage = request.messages.find(m => m.role === 'system');
    if (systemMessage && typeof systemMessage.content === 'string') {
      return systemMessage.content;
    }

    return undefined;
  }

  protected filterNonSystemMessages(messages: Message[]): Message[] {
    return messages.filter(m => m.role !== 'system');
  }

  protected getLastUserMessage(messages: Message[]): string {
    const userMessages = messages.filter(m => m.role === 'user');
    const lastMessage = userMessages[userMessages.length - 1];
    
    if (!lastMessage) {
      return '';
    }

    if (typeof lastMessage.content === 'string') {
      return lastMessage.content;
    }

    // Extract text from content parts
    return lastMessage.content
      .filter(part => part.type === 'text')
      .map(part => part.text || '')
      .join('\n');
  }

  // ============================================
  // TOKEN ESTIMATION
  // ============================================

  protected estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  protected estimateRequestTokens(request: ChatRequest): number {
    let total = 0;

    // System prompt
    if (request.systemPrompt) {
      total += this.estimateTokens(request.systemPrompt);
    }

    // Messages
    for (const message of request.messages) {
      if (typeof message.content === 'string') {
        total += this.estimateTokens(message.content);
      } else {
        for (const part of message.content) {
          if (part.text) {
            total += this.estimateTokens(part.text);
          }
          // Images add ~85 tokens for low detail, ~765 for high detail
          if (part.imageUrl || part.imageBase64) {
            total += 500; // Average estimate
          }
        }
      }
    }

    // Tools
    if (request.tools) {
      for (const tool of request.tools) {
        total += this.estimateTokens(JSON.stringify(tool));
      }
    }

    return total;
  }

  // ============================================
  // TOOL CONVERSION HELPERS
  // ============================================

  protected abstract convertTools(tools: ToolDefinition[]): unknown;

  // ============================================
  // OPTIONAL METHODS
  // ============================================

  async countTokens?(text: string, model?: string): Promise<number> {
    // Default implementation uses estimation
    return this.estimateTokens(text);
  }

  async validateApiKey?(): Promise<boolean> {
    try {
      // Try a minimal request to validate the key
      await this.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 1,
      });
      return true;
    } catch (error) {
      if (error instanceof LLMError && error.code === 'INVALID_API_KEY') {
        return false;
      }
      throw error;
    }
  }

  async listModels?(): Promise<ModelInfo[]> {
    return this.models;
  }

  // ============================================
  // RATE LIMIT STATUS
  // ============================================

  getRateLimitStatus() {
    return this.rateLimiter.getStatus();
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

export function generateResponseId(): string {
  return `resp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function generateToolCallId(): string {
  return `call_${Math.random().toString(36).substring(2, 11)}`;
}
