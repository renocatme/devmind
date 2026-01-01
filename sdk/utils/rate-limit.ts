/**
 * DevMind Multi-Provider LLM SDK - Rate Limiting
 */

import { RateLimitConfig } from '../types';

// ============================================
// TOKEN BUCKET RATE LIMITER
// ============================================

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private queue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private processing = false;

  constructor(private readonly config: RateLimitConfig) {
    this.tokens = config.requestsPerMinute;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refillTokens();

    if (this.tokens > 0) {
      this.tokens--;
      return;
    }

    // Wait in queue
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.processQueue();
    });
  }

  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = (elapsed / 60000) * this.config.requestsPerMinute;

    this.tokens = Math.min(
      this.config.requestsPerMinute,
      this.tokens + tokensToAdd
    );
    this.lastRefill = now;
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      this.refillTokens();

      if (this.tokens > 0) {
        this.tokens--;
        const item = this.queue.shift();
        item?.resolve();
      } else {
        // Wait for token refill
        const waitTime = (60000 / this.config.requestsPerMinute) + 10;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    this.processing = false;
  }

  getAvailableTokens(): number {
    this.refillTokens();
    return Math.floor(this.tokens);
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  reset(): void {
    this.tokens = this.config.requestsPerMinute;
    this.lastRefill = Date.now();
    
    // Reject all queued requests
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      item?.reject(new Error('Rate limiter reset'));
    }
  }
}

// ============================================
// SLIDING WINDOW RATE LIMITER
// ============================================

export class SlidingWindowRateLimiter {
  private requests: number[] = [];

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number = 60000
  ) {}

  async acquire(): Promise<void> {
    this.cleanup();

    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = oldestRequest + this.windowMs - Date.now();
      
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.cleanup();
      }
    }

    this.requests.push(Date.now());
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    this.requests = this.requests.filter(time => time > cutoff);
  }

  getRequestCount(): number {
    this.cleanup();
    return this.requests.length;
  }

  getRemainingRequests(): number {
    this.cleanup();
    return Math.max(0, this.maxRequests - this.requests.length);
  }

  getResetTime(): number {
    if (this.requests.length === 0) {
      return 0;
    }
    return this.requests[0] + this.windowMs - Date.now();
  }
}

// ============================================
// TOKEN RATE LIMITER (for token-based limits)
// ============================================

export class TokenRateLimiter {
  private tokensUsed: Array<{ count: number; time: number }> = [];

  constructor(
    private readonly maxTokensPerMinute: number
  ) {}

  async acquire(tokenCount: number): Promise<void> {
    this.cleanup();

    const currentUsage = this.getCurrentUsage();
    
    if (currentUsage + tokenCount > this.maxTokensPerMinute) {
      const waitTime = this.getWaitTime(tokenCount);
      
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.cleanup();
      }
    }

    this.tokensUsed.push({ count: tokenCount, time: Date.now() });
  }

  private cleanup(): void {
    const cutoff = Date.now() - 60000;
    this.tokensUsed = this.tokensUsed.filter(entry => entry.time > cutoff);
  }

  private getCurrentUsage(): number {
    this.cleanup();
    return this.tokensUsed.reduce((sum, entry) => sum + entry.count, 0);
  }

  private getWaitTime(tokenCount: number): number {
    if (this.tokensUsed.length === 0) {
      return 0;
    }

    // Find when enough tokens will be available
    let tokensToFree = this.getCurrentUsage() + tokenCount - this.maxTokensPerMinute;
    
    for (const entry of this.tokensUsed) {
      tokensToFree -= entry.count;
      if (tokensToFree <= 0) {
        return entry.time + 60000 - Date.now();
      }
    }

    return 60000;
  }

  getRemainingTokens(): number {
    return Math.max(0, this.maxTokensPerMinute - this.getCurrentUsage());
  }
}

// ============================================
// COMBINED RATE LIMITER
// ============================================

export class CombinedRateLimiter {
  private requestLimiter: SlidingWindowRateLimiter;
  private tokenLimiter?: TokenRateLimiter;

  constructor(config: RateLimitConfig) {
    this.requestLimiter = new SlidingWindowRateLimiter(
      config.requestsPerMinute
    );

    if (config.tokensPerMinute) {
      this.tokenLimiter = new TokenRateLimiter(config.tokensPerMinute);
    }
  }

  async acquire(estimatedTokens?: number): Promise<void> {
    await this.requestLimiter.acquire();

    if (this.tokenLimiter && estimatedTokens) {
      await this.tokenLimiter.acquire(estimatedTokens);
    }
  }

  getStatus(): {
    remainingRequests: number;
    remainingTokens?: number;
    resetTime: number;
  } {
    return {
      remainingRequests: this.requestLimiter.getRemainingRequests(),
      remainingTokens: this.tokenLimiter?.getRemainingTokens(),
      resetTime: this.requestLimiter.getResetTime(),
    };
  }
}
