/**
 * DevMind Multi-Provider LLM SDK - Error Handling
 */

import { ErrorCode, ProviderName } from './types';

// ============================================
// BASE ERROR CLASS
// ============================================

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly provider: ProviderName,
    public readonly retryable: boolean = false,
    public readonly statusCode?: number,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'LLMError';
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LLMError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      provider: this.provider,
      retryable: this.retryable,
      statusCode: this.statusCode,
    };
  }
}

// ============================================
// SPECIFIC ERROR CLASSES
// ============================================

export class RateLimitError extends LLMError {
  constructor(
    provider: ProviderName,
    public readonly retryAfterMs?: number,
    originalError?: unknown
  ) {
    super(
      `Rate limit exceeded for ${provider}${retryAfterMs ? `. Retry after ${retryAfterMs}ms` : ''}`,
      ErrorCode.RATE_LIMIT,
      provider,
      true,
      429,
      originalError
    );
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends LLMError {
  constructor(provider: ProviderName, originalError?: unknown) {
    super(
      `Invalid API key for ${provider}`,
      ErrorCode.INVALID_API_KEY,
      provider,
      false,
      401,
      originalError
    );
    this.name = 'AuthenticationError';
  }
}

export class ModelNotFoundError extends LLMError {
  constructor(
    provider: ProviderName,
    public readonly modelId: string,
    originalError?: unknown
  ) {
    super(
      `Model '${modelId}' not found for ${provider}`,
      ErrorCode.MODEL_NOT_FOUND,
      provider,
      false,
      404,
      originalError
    );
    this.name = 'ModelNotFoundError';
  }
}

export class ContextLengthError extends LLMError {
  constructor(
    provider: ProviderName,
    public readonly tokenCount: number,
    public readonly maxTokens: number,
    originalError?: unknown
  ) {
    super(
      `Context length exceeded for ${provider}: ${tokenCount} tokens (max: ${maxTokens})`,
      ErrorCode.CONTEXT_LENGTH_EXCEEDED,
      provider,
      false,
      400,
      originalError
    );
    this.name = 'ContextLengthError';
  }
}

export class ContentFilterError extends LLMError {
  constructor(
    provider: ProviderName,
    public readonly reason?: string,
    originalError?: unknown
  ) {
    super(
      `Content filtered by ${provider}${reason ? `: ${reason}` : ''}`,
      ErrorCode.CONTENT_FILTERED,
      provider,
      false,
      400,
      originalError
    );
    this.name = 'ContentFilterError';
  }
}

export class NetworkError extends LLMError {
  constructor(provider: ProviderName, originalError?: unknown) {
    super(
      `Network error connecting to ${provider}`,
      ErrorCode.NETWORK_ERROR,
      provider,
      true,
      undefined,
      originalError
    );
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends LLMError {
  constructor(
    provider: ProviderName,
    public readonly timeoutMs: number,
    originalError?: unknown
  ) {
    super(
      `Request to ${provider} timed out after ${timeoutMs}ms`,
      ErrorCode.TIMEOUT,
      provider,
      true,
      408,
      originalError
    );
    this.name = 'TimeoutError';
  }
}

export class InvalidRequestError extends LLMError {
  constructor(
    provider: ProviderName,
    message: string,
    originalError?: unknown
  ) {
    super(
      `Invalid request to ${provider}: ${message}`,
      ErrorCode.INVALID_REQUEST,
      provider,
      false,
      400,
      originalError
    );
    this.name = 'InvalidRequestError';
  }
}

// ============================================
// ERROR UTILITIES
// ============================================

export function isLLMError(error: unknown): error is LLMError {
  return error instanceof LLMError;
}

export function isRetryableError(error: unknown): boolean {
  if (isLLMError(error)) {
    return error.retryable;
  }
  
  // Check for common retryable network errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('socket hang up')
    );
  }
  
  return false;
}

export function normalizeError(
  error: unknown,
  provider: ProviderName
): LLMError {
  if (isLLMError(error)) {
    return error;
  }

  if (error instanceof Error) {
    // Try to detect error type from message
    const message = error.message.toLowerCase();
    
    if (message.includes('rate limit') || message.includes('429')) {
      return new RateLimitError(provider, undefined, error);
    }
    
    if (message.includes('unauthorized') || message.includes('401') || message.includes('api key')) {
      return new AuthenticationError(provider, error);
    }
    
    if (message.includes('not found') || message.includes('404')) {
      return new ModelNotFoundError(provider, 'unknown', error);
    }
    
    if (message.includes('context') || message.includes('token')) {
      return new ContextLengthError(provider, 0, 0, error);
    }
    
    if (message.includes('network') || message.includes('fetch')) {
      return new NetworkError(provider, error);
    }
    
    if (message.includes('timeout')) {
      return new TimeoutError(provider, 0, error);
    }
    
    return new LLMError(
      error.message,
      ErrorCode.UNKNOWN,
      provider,
      false,
      undefined,
      error
    );
  }

  return new LLMError(
    String(error),
    ErrorCode.UNKNOWN,
    provider,
    false,
    undefined,
    error
  );
}
