/**
 * DevMind Multi-Provider LLM SDK - Ollama Provider (Local Models)
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
} from '../types';
import { BaseProvider, generateResponseId, generateToolCallId } from './base';
import { NetworkError, InvalidRequestError } from '../errors';
import { parseNDJSON } from '../utils/streaming';

// ============================================
// OLLAMA PROVIDER
// ============================================

export class OllamaProvider extends BaseProvider {
  readonly name = 'ollama' as const;
  
  // Default models - will be updated dynamically
  private _models: ModelInfo[] = [
    {
      id: 'llama3.2',
      name: 'Llama 3.2',
      contextWindow: 128000,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: 'llama3.2:1b',
      name: 'Llama 3.2 1B',
      contextWindow: 128000,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: 'codellama',
      name: 'Code Llama',
      contextWindow: 16000,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
    },
    {
      id: 'mistral',
      name: 'Mistral',
      contextWindow: 32000,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: 'mixtral',
      name: 'Mixtral',
      contextWindow: 32000,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: 'llava',
      name: 'LLaVA',
      contextWindow: 4096,
      supportsVision: true,
      supportsTools: false,
      supportsStreaming: true,
    },
  ];

  get models(): ModelInfo[] {
    return this._models;
  }

  private baseUrl: string;

  constructor(config: ProviderConfig, retryConfig?: RetryConfig, debug = false) {
    super(config, retryConfig, debug);
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  // ============================================
  // CHAT IMPLEMENTATION
  // ============================================

  async chat(request: ChatRequest): Promise<ChatResponse> {
    await this.checkRateLimit();

    const url = `${this.baseUrl}/api/chat`;
    const body = this.buildRequestBody(request, false);
    
    this.log('Request:', JSON.stringify(body, null, 2));

    try {
      const response = await this.withRetry(() =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new InvalidRequestError('ollama', error.error || response.statusText);
      }

      const data = await response.json();
      return this.parseResponse(data, request);
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new NetworkError('ollama', error);
      }
      this.handleError(error);
    }
  }

  // ============================================
  // STREAMING IMPLEMENTATION
  // ============================================

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    await this.checkRateLimit();

    const url = `${this.baseUrl}/api/chat`;
    const body = this.buildRequestBody(request, true);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        yield { type: 'error', error: error.error || response.statusText };
        return;
      }

      let totalTokens = 0;
      let promptTokens = 0;

      for await (const data of parseNDJSON(response)) {
        const message = data.message as Record<string, unknown> | undefined;
        
        if (message?.content) {
          yield { type: 'text', content: message.content as string };
        }

        // Handle tool calls
        if (message?.tool_calls) {
          for (const tc of message.tool_calls as Record<string, unknown>[]) {
            const fn = tc.function as Record<string, unknown>;
            yield {
              type: 'tool_call',
              toolCall: {
                id: generateToolCallId(),
                name: fn.name as string,
                arguments: (fn.arguments as Record<string, unknown>) || {},
              },
            };
          }
        }

        // Track tokens
        if (data.prompt_eval_count) {
          promptTokens = data.prompt_eval_count as number;
        }
        if (data.eval_count) {
          totalTokens = data.eval_count as number;
        }

        // Check if done
        if (data.done) {
          yield {
            type: 'usage',
            usage: {
              promptTokens,
              completionTokens: totalTokens,
              totalTokens: promptTokens + totalTokens,
            },
          };
          yield { type: 'done' };
          return;
        }
      }
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        yield { type: 'error', error: 'Cannot connect to Ollama. Is it running?' };
      } else {
        yield { type: 'error', error: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  // ============================================
  // REQUEST BUILDING
  // ============================================

  private buildRequestBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.getModel(request),
      messages: this.convertMessages(request),
      stream,
    };

    // Options
    const options: Record<string, unknown> = {};
    if (request.temperature !== undefined) options.temperature = request.temperature;
    if (request.topP !== undefined) options.top_p = request.topP;
    if (request.topK !== undefined) options.top_k = request.topK;
    if (request.maxTokens !== undefined) options.num_predict = request.maxTokens;
    if (request.stopSequences?.length) options.stop = request.stopSequences;

    if (Object.keys(options).length > 0) {
      body.options = options;
    }

    // Tools (if supported by model)
    if (request.tools?.length) {
      body.tools = this.convertTools(request.tools);
    }

    // Response format
    if (request.responseFormat?.type === 'json_object') {
      body.format = 'json';
    }

    return body;
  }

  // ============================================
  // MESSAGE CONVERSION
  // ============================================

  private convertMessages(request: ChatRequest): unknown[] {
    const messages: unknown[] = [];

    // System prompt
    const systemPrompt = this.extractSystemPrompt(request);
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
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
        content: typeof message.content === 'string' ? message.content : '',
      };
    }

    // Handle assistant with tool calls
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: typeof message.content === 'string' ? message.content : '',
        tool_calls: message.toolCalls.map(tc => ({
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        })),
      };
    }

    // Handle content
    if (typeof message.content === 'string') {
      base.content = message.content;
    } else {
      // Handle multimodal - extract text and images
      const textParts: string[] = [];
      const images: string[] = [];

      for (const part of message.content) {
        if (part.type === 'text' && part.text) {
          textParts.push(part.text);
        }
        if (part.type === 'image' && part.imageBase64) {
          images.push(part.imageBase64);
        }
      }

      base.content = textParts.join('\n');
      if (images.length > 0) {
        base.images = images;
      }
    }

    return base;
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

  // ============================================
  // RESPONSE PARSING
  // ============================================

  private parseResponse(data: Record<string, unknown>, request: ChatRequest): ChatResponse {
    const message = data.message as Record<string, unknown> | undefined;
    const content = (message?.content as string) || '';

    // Extract tool calls
    const toolCalls: ToolCall[] = [];
    if (message?.tool_calls) {
      for (const tc of message.tool_calls as Record<string, unknown>[]) {
        const fn = tc.function as Record<string, unknown>;
        toolCalls.push({
          id: generateToolCallId(),
          name: fn.name as string,
          arguments: (fn.arguments as Record<string, unknown>) || {},
        });
      }
    }

    // Parse usage
    const usage: TokenUsage = {
      promptTokens: (data.prompt_eval_count as number) || 0,
      completionTokens: (data.eval_count as number) || 0,
      totalTokens: ((data.prompt_eval_count as number) || 0) + ((data.eval_count as number) || 0),
    };

    // Determine finish reason
    let finishReason: FinishReason = 'stop';
    if (toolCalls.length > 0) {
      finishReason = 'tool_calls';
    } else if (data.done_reason === 'length') {
      finishReason = 'length';
    }

    return {
      id: generateResponseId(),
      model: this.getModel(request),
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      finishReason,
      provider: 'ollama',
    };
  }

  // ============================================
  // MODEL MANAGEMENT
  // ============================================

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      
      if (!response.ok) {
        return this._models;
      }

      const data = await response.json();
      const models = data.models as Record<string, unknown>[];

      if (!models?.length) {
        return this._models;
      }

      this._models = models.map(m => ({
        id: m.name as string,
        name: m.name as string,
        contextWindow: 128000, // Default, actual varies by model
        supportsVision: (m.name as string).includes('llava') || (m.name as string).includes('vision'),
        supportsTools: true,
        supportsStreaming: true,
      }));

      return this._models;
    } catch {
      return this._models;
    }
  }

  async pullModel(modelName: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
    });

    if (!response.ok) {
      throw new InvalidRequestError('ollama', `Failed to pull model: ${modelName}`);
    }

    // Stream the pull progress
    for await (const data of parseNDJSON(response)) {
      this.log('Pull progress:', data);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
