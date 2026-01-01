/**
 * DevMind Multi-Provider LLM SDK - Streaming Utilities
 */

import { StreamChunk, StreamOptions, ToolCall, TokenUsage } from '../types';

// ============================================
// STREAM PROCESSOR
// ============================================

export class StreamProcessor {
  private textBuffer = '';
  private toolCallBuffer: Map<string, Partial<ToolCall>> = new Map();
  private thinkingBuffer = '';
  private usage: TokenUsage | null = null;

  constructor(private readonly options?: StreamOptions) {}

  processChunk(chunk: StreamChunk): void {
    switch (chunk.type) {
      case 'text':
        if (chunk.content) {
          this.textBuffer += chunk.content;
          this.options?.onText?.(chunk.content);
        }
        break;

      case 'tool_call':
        if (chunk.toolCall) {
          this.processToolCallChunk(chunk.toolCall);
        }
        break;

      case 'thinking':
        if (chunk.content) {
          this.thinkingBuffer += chunk.content;
          this.options?.onThinking?.(chunk.content);
        }
        break;

      case 'usage':
        if (chunk.usage) {
          this.usage = chunk.usage;
          this.options?.onUsage?.(chunk.usage);
        }
        break;

      case 'error':
        if (chunk.error) {
          this.options?.onError?.(new Error(chunk.error));
        }
        break;

      case 'done':
        // Finalize any pending tool calls
        this.finalizeToolCalls();
        break;
    }
  }

  private processToolCallChunk(partial: Partial<ToolCall>): void {
    if (!partial.id) return;

    const existing = this.toolCallBuffer.get(partial.id) || {};
    
    const updated: Partial<ToolCall> = {
      ...existing,
      ...partial,
    };

    // Merge arguments if both exist
    if (existing.arguments && partial.arguments) {
      updated.arguments = {
        ...existing.arguments,
        ...partial.arguments,
      };
    }

    this.toolCallBuffer.set(partial.id, updated);
  }

  private finalizeToolCalls(): void {
    for (const [id, partial] of this.toolCallBuffer) {
      if (partial.name && partial.arguments) {
        const toolCall: ToolCall = {
          id,
          name: partial.name,
          arguments: partial.arguments,
        };
        this.options?.onToolCall?.(toolCall);
      }
    }
  }

  getText(): string {
    return this.textBuffer;
  }

  getToolCalls(): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const [id, partial] of this.toolCallBuffer) {
      if (partial.name && partial.arguments) {
        calls.push({
          id,
          name: partial.name,
          arguments: partial.arguments,
        });
      }
    }
    return calls;
  }

  getThinking(): string {
    return this.thinkingBuffer;
  }

  getUsage(): TokenUsage | null {
    return this.usage;
  }

  reset(): void {
    this.textBuffer = '';
    this.toolCallBuffer.clear();
    this.thinkingBuffer = '';
    this.usage = null;
  }
}

// ============================================
// ASYNC ITERATOR HELPERS
// ============================================

export async function* mergeStreams<T>(
  ...streams: AsyncGenerator<T>[]
): AsyncGenerator<T> {
  const iterators = streams.map(s => s[Symbol.asyncIterator]());
  const pending = new Map<number, Promise<{ index: number; result: IteratorResult<T> }>>();

  // Initialize all iterators
  for (let i = 0; i < iterators.length; i++) {
    pending.set(i, iterators[i].next().then(result => ({ index: i, result })));
  }

  while (pending.size > 0) {
    const { index, result } = await Promise.race(pending.values());

    if (result.done) {
      pending.delete(index);
    } else {
      yield result.value;
      pending.set(index, iterators[index].next().then(r => ({ index, result: r })));
    }
  }
}

export async function collectStream<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of stream) {
    results.push(item);
  }
  return results;
}

export async function* mapStream<T, U>(
  stream: AsyncGenerator<T>,
  fn: (item: T) => U
): AsyncGenerator<U> {
  for await (const item of stream) {
    yield fn(item);
  }
}

export async function* filterStream<T>(
  stream: AsyncGenerator<T>,
  predicate: (item: T) => boolean
): AsyncGenerator<T> {
  for await (const item of stream) {
    if (predicate(item)) {
      yield item;
    }
  }
}

// ============================================
// TEXT STREAM HELPERS
// ============================================

export async function* textChunksToStream(
  chunks: AsyncGenerator<StreamChunk>
): AsyncGenerator<string> {
  for await (const chunk of chunks) {
    if (chunk.type === 'text' && chunk.content) {
      yield chunk.content;
    }
  }
}

export async function streamToText(
  stream: AsyncGenerator<StreamChunk>
): Promise<string> {
  let text = '';
  for await (const chunk of stream) {
    if (chunk.type === 'text' && chunk.content) {
      text += chunk.content;
    }
  }
  return text;
}

// ============================================
// SSE PARSER
// ============================================

export async function* parseSSE(
  response: Response
): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          
          if (data === '[DONE]') {
            return;
          }

          try {
            yield JSON.parse(data);
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ============================================
// NDJSON PARSER
// ============================================

export async function* parseNDJSON(
  response: Response
): AsyncGenerator<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        // Process remaining buffer
        if (buffer.trim()) {
          try {
            yield JSON.parse(buffer);
          } catch {
            // Skip invalid JSON
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            yield JSON.parse(line);
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
