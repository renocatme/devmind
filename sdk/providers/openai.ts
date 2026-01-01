/**
 * DevMind Multi-Provider LLM SDK - OpenAI Provider
 */

import {
  ProviderConfig,
  ModelInfo,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  Message,
  ToolDefinition,
  ToolCall,
  TokenUsage,
  FinishReason,
  RetryConfig,
  ContentPart,
} from '../types';
import { BaseProvider, generateResponseId, generateToolCallId } from './base';
import { AuthenticationError, InvalidRequestError } from '../errors';
import { parseSSE } from '../utils/streaming';

// ============================================
// OPENAI PROVIDER
// ============================================

export class OpenAIProvider extends BaseProvider {
  readonly name = 'openai' as const;
  
  readonly models: ModelInfo[] = [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      contextWindow: 128000,
      maxOutputTokens: 16384,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      contextWindow: 128000,
      maxOutputTokens: 16384,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: 'gpt-4-turbo',
      name: 'GPT-4 Turbo',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: 'o1',
      name: 'o1',
      contextWindow: 200000,
      maxOutputTokens: 100000,
      supportsVision: true,
      supportsTools: false,
      supportsStreaming: true,
    },
    {
      id: 'o1-mini',
      name: 'o1 Mini',
      contextWindow: 128000,
      maxOutputTokens: 65536,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
    },
  ];

  private baseUrl: string;
  private apiKey: string;

  constructor(config: ProviderConfig, retryConfig?: RetryConfig, debug = false) {
    super(config, retryConfig, debug);
    
    if (!config.apiKey) {
      throw new AuthenticationError('openai');
    }
    
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  }

  // ============================================
  // CHAT IMPLEMENTATION
  // ============================================

  async chat(request: ChatRequest): Promise<ChatResponse> {
    await this.checkRateLimit(this.estimateRequestTokens(request));

    const url = `${this.baseUrl}/chat/completions`;
    const body = this.buildRequestBody(request, false);
    
    this.log('Request:', JSON.stringify(body, null, 2));

    try {
      const response = await this.withRetry(() =>
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        })
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new InvalidRequestError('openai', error.error?.message || response.statusText);
      }

      const data = await response.json();
      return this.parseResponse(data);
    } catch (error) {
      this.handleError(error);
    }
  }

  // ============================================
  // STREAMING IMPLEMENTATION
  // ============================================

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    await this.checkRateLimit(this.estimateRequestTokens(request));

    const url = `${this.baseUrl}/chat/completions`;
    const body = this.buildRequestBody(request, true);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        yield { type: 'error', error: error.error?.message || response.statusText };
        return;
      }

      const toolCallBuffers: Map<number, Partial<ToolCall>> = new Map();
      let usage: TokenUsage | undefined;

      for await (const data of parseSSE(response)) {
        const choice = (data.choices as unknown[])?.[0] as Record<string, unknown> | undefined;
        const delta = choice?.delta as Record<string, unknown> | undefined;

        if (delta?.content) {
          yield { type: 'text', content: delta.content as string };
        }

        // Handle tool calls
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls as Record<string, unknown>[]) {
            const index = tc.index as number;
            const existing = toolCallBuffers.get(index) || {};
            
            if (tc.id) existing.id = tc.id as string;
            if (tc.function) {
              const fn = tc.function as Record<string, unknown>;
              if (fn.name) existing.name = fn.name as string;
              if (fn.arguments) {
                const args = existing.arguments as Record<string, unknown> || {};
                try {
                  const parsed = JSON.parse(fn.arguments as string);
                  existing.arguments = { ...args, ...parsed };
                } catch {
                  // Arguments might be streamed in chunks
                }
              }
            }
            
            toolCallBuffers.set(index, existing);
          }
        }

        // Handle usage in stream
        if (data.usage) {
          const u = data.usage as Record<string, number>;
          usage = {
            promptTokens: u.prompt_tokens || 0,
            completionTokens: u.completion_tokens || 0,
            totalTokens: u.total_tokens || 0,
          };
        }
      }

      // Emit completed tool calls
      for (const [, tc] of toolCallBuffers) {
        if (tc.id && tc.name) {
          yield {
            type: 'tool_call',
            toolCall: {
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments || {},
            },
          };
        }
      }

      if (usage) {
        yield { type: 'usage', usage };
      }

      yield { type: 'done' };
    } catch (error) {
      yield { type: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ============================================
  // REQUEST BUILDING
  // ============================================

  private buildRequestBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
    const model = this.getModel(request);
    const isO1Model = model.startsWith('o1');

    const body: Record<string, unknown> = {
      model,
      messages: this.convertMessages(request, isO1Model),
      stream,
    };

    // o1 models have different parameters
    if (!isO1Model) {
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.topP !== undefined) body.top_p = request.topP;
      if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
      if (request.stopSequences?.length) body.stop = request.stopSequences;

      // Tools
      if (request.tools?.length) {
        body.tools = this.convertTools(request.tools);
        
        if (request.toolChoice) {
          body.tool_choice = this.convertToolChoice(request.toolChoice);
        }
      }

      // Response format
      if (request.responseFormat) {
        body.response_format = this.convertResponseFormat(request.responseFormat);
      }
    } else {
      // o1 models use max_completion_tokens
      if (request.maxTokens !== undefined) {
        body.max_completion_tokens = request.maxTokens;
      }
    }

    // Stream options for usage
    if (stream) {
      body.stream_options = { include_usage: true };
    }

    return body;
  }

  // ============================================
  // MESSAGE CONVERSION
  // ============================================

  private convertMessages(request: ChatRequest, isO1Model: boolean): unknown[] {
    const messages: unknown[] = [];

    // System prompt (not supported in o1 models)
    if (!isO1Model) {
      const systemPrompt = this.extractSystemPrompt(request);
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
    }

    // Convert messages
    for (const message of this.filterNonSystemMessages(request.messages)) {
      messages.push(this.convertMessage(message));
    }

    return messages;
  }

  private convertMessage(message: Message): unknown {
    const base: Record<string, unknown> = {
      role: message.role,
    };

    // Handle tool results
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: typeof message.content === 'string' ? message.content : '',
      };
    }

    // Handle assistant with tool calls
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: typeof message.content === 'string' ? message.content : null,
        tool_calls: message.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      };
    }

    // Handle content
    if (typeof message.content === 'string') {
      base.content = message.content;
    } else {
      base.content = message.content.map(part => this.convertContentPart(part));
    }

    return base;
  }

  private convertContentPart(part: ContentPart): unknown {
    switch (part.type) {
      case 'text':
        return { type: 'text', text: part.text || '' };
      
      case 'image':
        if (part.imageBase64) {
          return {
            type: 'image_url',
            image_url: {
              url: `data:${part.mimeType || 'image/jpeg'};base64,${part.imageBase64}`,
            },
          };
        }
        if (part.imageUrl) {
          return {
            type: 'image_url',
            image_url: { url: part.imageUrl },
          };
        }
        return { type: 'text', text: '[Image]' };
      
      default:
        return { type: 'text', text: '' };
    }
  }

  // ============================================
  // TOOL CONVERSION
  // ============================================

  protected convertTools(tools: ToolDefinition[]): unknown[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private convertToolChoice(choice: ChatRequest['toolChoice']): unknown {
    if (choice === 'none') return 'none';
    if (choice === 'auto') return 'auto';
    if (choice === 'required') return 'required';
    if (typeof choice === 'object' && choice.name) {
      return { type: 'function', function: { name: choice.name } };
    }
    return 'auto';
  }

  private convertResponseFormat(format: ChatRequest['responseFormat']): unknown {
    if (!format) return undefined;
    
    if (format.type === 'json_object') {
      return { type: 'json_object' };
    }
    
    if (format.type === 'json_schema' && format.schema) {
      return {
        type: 'json_schema',
        json_schema: format.schema,
      };
    }
    
    return { type: 'text' };
  }

  // ============================================
  // RESPONSE PARSING
  // ============================================

  private parseResponse(data: Record<string, unknown>): ChatResponse {
    const choice = (data.choices as unknown[])?.[0] as Record<string, unknown> | undefined;
    const message = choice?.message as Record<string, unknown> | undefined;

    // Extract content
    const content = (message?.content as string) || '';

    // Extract tool calls
    const toolCalls: ToolCall[] = [];
    if (message?.tool_calls) {
      for (const tc of message.tool_calls as Record<string, unknown>[]) {
        const fn = tc.function as Record<string, unknown>;
        toolCalls.push({
          id: (tc.id as string) || generateToolCallId(),
          name: fn.name as string,
          arguments: JSON.parse((fn.arguments as string) || '{}'),
        });
      }
    }

    // Parse usage
    const usageData = data.usage as Record<string, number> | undefined;
    const usage: TokenUsage = {
      promptTokens: usageData?.prompt_tokens || 0,
      completionTokens: usageData?.completion_tokens || 0,
      totalTokens: usageData?.total_tokens || 0,
    };

    // Parse finish reason
    const finishReason = this.parseFinishReason(choice?.finish_reason as string);

    return {
      id: (data.id as string) || generateResponseId(),
      model: data.model as string,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      finishReason,
      provider: 'openai',
    };
  }

  private parseFinishReason(reason?: string): FinishReason {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}
