/**
 * DevMind Multi-Provider LLM SDK - Anthropic Provider
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
// ANTHROPIC PROVIDER
// ============================================

export class AnthropicProvider extends BaseProvider {
  readonly name = 'anthropic' as const;
  
  readonly models: ModelInfo[] = [
    {
      id: 'claude-3-5-sonnet-20241022',
      name: 'Claude 3.5 Sonnet',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: 'claude-3-opus-20240229',
      name: 'Claude 3 Opus',
      contextWindow: 200000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: 'claude-3-haiku-20240307',
      name: 'Claude 3 Haiku',
      contextWindow: 200000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: 'claude-3-5-haiku-20241022',
      name: 'Claude 3.5 Haiku',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
    },
  ];

  private baseUrl: string;
  private apiKey: string;
  private apiVersion = '2023-06-01';

  constructor(config: ProviderConfig, retryConfig?: RetryConfig, debug = false) {
    super(config, retryConfig, debug);
    
    if (!config.apiKey) {
      throw new AuthenticationError('anthropic');
    }
    
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
  }

  // ============================================
  // CHAT IMPLEMENTATION
  // ============================================

  async chat(request: ChatRequest): Promise<ChatResponse> {
    await this.checkRateLimit(this.estimateRequestTokens(request));

    const url = `${this.baseUrl}/messages`;
    const body = this.buildRequestBody(request, false);
    
    this.log('Request:', JSON.stringify(body, null, 2));

    try {
      const response = await this.withRetry(() =>
        fetch(url, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(body),
        })
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new InvalidRequestError('anthropic', error.error?.message || response.statusText);
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

    const url = `${this.baseUrl}/messages`;
    const body = this.buildRequestBody(request, true);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        yield { type: 'error', error: error.error?.message || response.statusText };
        return;
      }

      let currentToolCall: Partial<ToolCall> | null = null;
      let inputJsonBuffer = '';
      let usage: TokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      for await (const data of parseSSE(response)) {
        const eventType = data.type as string;

        switch (eventType) {
          case 'message_start': {
            const message = data.message as Record<string, unknown>;
            const u = message?.usage as Record<string, number>;
            if (u) {
              usage.promptTokens = u.input_tokens || 0;
            }
            break;
          }

          case 'content_block_start': {
            const block = data.content_block as Record<string, unknown>;
            if (block?.type === 'tool_use') {
              currentToolCall = {
                id: block.id as string,
                name: block.name as string,
                arguments: {},
              };
              inputJsonBuffer = '';
            }
            break;
          }

          case 'content_block_delta': {
            const delta = data.delta as Record<string, unknown>;
            
            if (delta?.type === 'text_delta') {
              yield { type: 'text', content: delta.text as string };
            }
            
            if (delta?.type === 'input_json_delta' && currentToolCall) {
              inputJsonBuffer += delta.partial_json as string;
            }

            if (delta?.type === 'thinking_delta') {
              yield { type: 'thinking', content: delta.thinking as string };
            }
            break;
          }

          case 'content_block_stop': {
            if (currentToolCall && inputJsonBuffer) {
              try {
                currentToolCall.arguments = JSON.parse(inputJsonBuffer);
              } catch {
                currentToolCall.arguments = {};
              }
              
              yield {
                type: 'tool_call',
                toolCall: currentToolCall as ToolCall,
              };
              
              currentToolCall = null;
              inputJsonBuffer = '';
            }
            break;
          }

          case 'message_delta': {
            const delta = data.delta as Record<string, unknown>;
            const u = data.usage as Record<string, number>;
            if (u) {
              usage.completionTokens = u.output_tokens || 0;
              usage.totalTokens = usage.promptTokens + usage.completionTokens;
            }
            break;
          }

          case 'message_stop': {
            yield { type: 'usage', usage };
            yield { type: 'done' };
            break;
          }
        }
      }
    } catch (error) {
      yield { type: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ============================================
  // HEADERS
  // ============================================

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': this.apiVersion,
    };
  }

  // ============================================
  // REQUEST BUILDING
  // ============================================

  private buildRequestBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.getModel(request),
      messages: this.convertMessages(request.messages),
      max_tokens: request.maxTokens || 4096,
      stream,
    };

    // System prompt
    const systemPrompt = this.extractSystemPrompt(request);
    if (systemPrompt) {
      body.system = systemPrompt;
    }

    // Optional parameters
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;
    if (request.topK !== undefined) body.top_k = request.topK;
    if (request.stopSequences?.length) body.stop_sequences = request.stopSequences;

    // Tools
    if (request.tools?.length) {
      body.tools = this.convertTools(request.tools);
      
      if (request.toolChoice) {
        body.tool_choice = this.convertToolChoice(request.toolChoice);
      }
    }

    return body;
  }

  // ============================================
  // MESSAGE CONVERSION
  // ============================================

  private convertMessages(messages: Message[]): unknown[] {
    const result: unknown[] = [];
    const nonSystemMessages = this.filterNonSystemMessages(messages);

    for (const message of nonSystemMessages) {
      result.push(this.convertMessage(message));
    }

    return result;
  }

  private convertMessage(message: Message): unknown {
    // Handle tool results
    if (message.role === 'tool') {
      return {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: typeof message.content === 'string' ? message.content : '',
        }],
      };
    }

    // Handle assistant with tool calls
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const content: unknown[] = [];
      
      if (typeof message.content === 'string' && message.content) {
        content.push({ type: 'text', text: message.content });
      }
      
      for (const tc of message.toolCalls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      
      return { role: 'assistant', content };
    }

    // Handle regular messages
    if (typeof message.content === 'string') {
      return {
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      };
    }

    // Handle multimodal content
    return {
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content.map(part => this.convertContentPart(part)),
    };
  }

  private convertContentPart(part: ContentPart): unknown {
    switch (part.type) {
      case 'text':
        return { type: 'text', text: part.text || '' };
      
      case 'image':
        if (part.imageBase64) {
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: part.mimeType || 'image/jpeg',
              data: part.imageBase64,
            },
          };
        }
        if (part.imageUrl) {
          return {
            type: 'image',
            source: {
              type: 'url',
              url: part.imageUrl,
            },
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
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  private convertToolChoice(choice: ChatRequest['toolChoice']): unknown {
    if (choice === 'none') return { type: 'none' };
    if (choice === 'auto') return { type: 'auto' };
    if (choice === 'required') return { type: 'any' };
    if (typeof choice === 'object' && choice.name) {
      return { type: 'tool', name: choice.name };
    }
    return { type: 'auto' };
  }

  // ============================================
  // RESPONSE PARSING
  // ============================================

  private parseResponse(data: Record<string, unknown>): ChatResponse {
    const content = data.content as unknown[];
    
    // Extract text and tool calls
    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const block of content) {
      const b = block as Record<string, unknown>;
      
      if (b.type === 'text') {
        text += b.text as string;
      }
      
      if (b.type === 'tool_use') {
        toolCalls.push({
          id: b.id as string,
          name: b.name as string,
          arguments: (b.input as Record<string, unknown>) || {},
        });
      }
    }

    // Parse usage
    const usageData = data.usage as Record<string, number> | undefined;
    const usage: TokenUsage = {
      promptTokens: usageData?.input_tokens || 0,
      completionTokens: usageData?.output_tokens || 0,
      totalTokens: (usageData?.input_tokens || 0) + (usageData?.output_tokens || 0),
    };

    // Parse finish reason
    const finishReason = this.parseFinishReason(data.stop_reason as string);

    return {
      id: (data.id as string) || generateResponseId(),
      model: data.model as string,
      content: text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      finishReason,
      provider: 'anthropic',
    };
  }

  private parseFinishReason(reason?: string): FinishReason {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }
}
