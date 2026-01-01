/**
 * DevMind Multi-Provider LLM SDK - Retry Utilities
 */

import { RetryConfig } from '../types';
import { isRetryableError, LLMError } from '../errors';

// ============================================
// RETRY FUNCTION
// ============================================

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  onRetry?: (attempt: number, error: Error, delayMs: number) => void
): Promise<T> {
  let lastError: Error | undefined;
  let delay = config.initialDelayMs;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      if (!isRetryableError(error)) {
        throw error;
      }

      // Check if we have retries left
      if (attempt >= config.maxRetries) {
        throw error;
      }

      // Check if error code is in retryable list
      if (error instanceof LLMError && config.retryableErrors) {
        if (!config.retryableErrors.includes(error.code)) {
          throw error;
        }
      }

      // Notify about retry
      onRetry?.(attempt + 1, lastError, delay);

      // Wait before retrying
      await sleep(delay);

      // Calculate next delay with exponential backoff
      delay = Math.min(
        delay * config.backoffMultiplier,
        config.maxDelayMs
      );

      // Add jitter to prevent thundering herd
      delay = addJitter(delay);
    }
  }

  throw lastError || new Error('Retry failed');
}

// ============================================
// HELPER FUNCTIONS
// ============================================

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function addJitter(delay: number, factor = 0.1): number {
  const jitter = delay * factor * (Math.random() * 2 - 1);
  return Math.max(0, delay + jitter);
}

// ============================================
// RETRY WITH TIMEOUT
// ============================================

export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    }),
  ]);
}

export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  timeoutMs: number,
  onRetry?: (attempt: number, error: Error, delayMs: number) => void
): Promise<T> {
  return withRetry(
    () => withTimeout(fn, timeoutMs),
    config,
    onRetry
  );
}

// ============================================
// CIRCUIT BREAKER
// ============================================

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

export class CircuitBreaker {
  private state: CircuitBreakerState = {
    failures: 0,
    lastFailure: 0,
    state: 'closed',
  };

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly resetTimeoutMs: number = 60000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state.state === 'open') {
      if (Date.now() - this.state.lastFailure > this.resetTimeoutMs) {
        this.state.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.state.failures = 0;
    this.state.state = 'closed';
  }

  private onFailure(): void {
    this.state.failures++;
    this.state.lastFailure = Date.now();

    if (this.state.failures >= this.failureThreshold) {
      this.state.state = 'open';
    }
  }

  getState(): CircuitBreakerState['state'] {
    return this.state.state;
  }

  reset(): void {
    this.state = {
      failures: 0,
      lastFailure: 0,
      state: 'closed',
    };
  }
}
