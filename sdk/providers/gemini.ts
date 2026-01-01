/**
 * DevMind Multi-Provider LLM SDK - Gemini Provider
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

// ============================================
// GEMINI PROVIDER
// ============================================

export class GeminiProvider extends BaseProvider {
  readonly name = 'gemini' as const;
  
  readonly models: ModelInfo[] = [
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: 'gemini-3-pro-preview',
      name: 'Gemini 3 Pro Preview',
      contextWindow: 2000000,
      maxOutputTokens: 65536,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
    },
  ];

  private baseUrl: string;
  private apiKey: string;

  constructor(config: ProviderConfig, retryConfig?: RetryConfig, debug = false) {
    super(config, retryConfig, debug);
    
    if (!config.apiKey) {
      throw new AuthenticationError('gemini');
    }
    
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  }

  // ============================================
  // CHAT IMPLEMENTATION
  // ============================================

  async chat(request: ChatRequest): Promise<ChatResponse> {
    await this.checkRateLimit(this.estimateRequestTokens(request));

    const model = this.getModel(request);
    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;

    const body = this.buildRequestBody(request);
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
        throw new InvalidRequestError('gemini', error.error?.message || response.statusText);
      }

      const data = await response.json();
      return this.parseResponse(data, model);
    } catch (error) {
      this.handleError(error);
    }
  }

  // ============================================
  // STREAMING IMPLEMENTATION
  // ============================================

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    await this.checkRateLimit(this.estimateRequestTokens(request));

    const model = this.getModel(request);
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;

    const body = this.buildRequestBody(request);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        yield { type: 'error', error: error.error?.message || response.statusText };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield { type: 'error', error: 'No response body' };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let totalUsage: TokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (!data || data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              yield* this.parseStreamChunk(parsed, totalUsage);
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      yield { type: 'usage', usage: totalUsage };
      yield { type: 'done' };
    } catch (error) {
      yield { type: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ============================================
  // REQUEST BUILDING
  // ============================================

  private buildRequestBody(request: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      contents: this.convertMessages(request.messages),
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
        topP: request.topP,
        topK: request.topK,
        stopSequences: request.stopSequences,
      },
    };

    // System instruction
    const systemPrompt = this.extractSystemPrompt(request);
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    // Tools
    if (request.tools?.length) {
      body.tools = [{ functionDeclarations: this.convertTools(request.tools) }];
      
      if (request.toolChoice) {
        body.toolConfig = this.convertToolChoice(request.toolChoice);
      }
    }

    // Response format
    if (request.responseFormat?.type === 'json_object') {
      (body.generationConfig as Record<string, unknown>).responseMimeType = 'application/json';
    }

    return body;
  }

  // ============================================
  // MESSAGE CONVERSION
  // ============================================

  private convertMessages(messages: Message[]): unknown[] {
    const contents: unknown[] = [];
    const nonSystemMessages = this.filterNonSystemMessages(messages);

    for (const message of nonSystemMessages) {
      const parts = this.convertMessageContent(message);
      
      // Add tool call results
      if (message.role === 'tool' && message.toolCallId) {
        contents.push({
          role: 'function',
          parts: [{
            functionResponse: {
              name: message.name || 'unknown',
              response: { result: typeof message.content === 'string' ? message.content : '' },
            },
          }],
        });
        continue;
      }

      // Add tool calls from assistant
      if (message.role === 'assistant' && message.toolCalls?.length) {
        const toolParts = message.toolCalls.map(tc => ({
          functionCall: {
            name: tc.name,
            args: tc.arguments,
          },
        }));
        
        contents.push({
          role: 'model',
          parts: [...parts, ...toolParts],
        });
        continue;
      }

      contents.push({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts,
      });
    }

    return contents;
  }

  private convertMessageContent(message: Message): unknown[] {
    if (typeof message.content === 'string') {
      return [{ text: message.content }];
    }

    return message.content.map(part => this.convertContentPart(part));
  }

  private convertContentPart(part: ContentPart): unknown {
    switch (part.type) {
      case 'text':
        return { text: part.text || '' };
      
      case 'image':
        if (part.imageBase64) {
          return {
            inlineData: {
              mimeType: part.mimeType || 'image/jpeg',
              data: part.imageBase64,
            },
          };
        }
        if (part.imageUrl) {
          return {
            fileData: {
              mimeType: part.mimeType || 'image/jpeg',
              fileUri: part.imageUrl,
            },
          };
        }
        return { text: '[Image]' };
      
      default:
        return { text: '' };
    }
  }

  // ============================================
  // TOOL CONVERSION
  // ============================================

  protected convertTools(tools: ToolDefinition[]): unknown[] {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  private convertToolChoice(choice: ChatRequest['toolChoice']): unknown {
    if (choice === 'none') {
      return { functionCallingConfig: { mode: 'NONE' } };
    }
    if (choice === 'auto') {
      return { functionCallingConfig: { mode: 'AUTO' } };
    }
    if (choice === 'required') {
      return { functionCallingConfig: { mode: 'ANY' } };
    }
    if (typeof choice === 'object' && choice.name) {
      return {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: [choice.name],
        },
      };
    }
    return {};
  }

  // ============================================
  // RESPONSE PARSING
  // ============================================

  private parseResponse(data: Record<string, unknown>, model: string): ChatResponse {
    const candidate = (data.candidates as unknown[])?.[0] as Record<string, unknown> | undefined;
    const content = candidate?.content as Record<string, unknown> | undefined;
    const parts = (content?.parts as unknown[]) || [];

    // Extract text
    let text = '';
    const toolCalls: ToolCall[] = [];
    let thinking = '';

    for (const part of parts as Record<string, unknown>[]) {
      if (part.text) {
        text += part.text;
      }
      if (part.functionCall) {
        const fc = part.functionCall as Record<string, unknown>;
        toolCalls.push({
          id: generateToolCallId(),
          name: fc.name as string,
          arguments: (fc.args as Record<string, unknown>) || {},
        });
      }
      if (part.thought) {
        thinking += part.thought;
      }
    }

    // Parse usage
    const usageMetadata = data.usageMetadata as Record<string, number> | undefined;
    const usage: TokenUsage = {
      promptTokens: usageMetadata?.promptTokenCount || 0,
      completionTokens: usageMetadata?.candidatesTokenCount || 0,
      totalTokens: usageMetadata?.totalTokenCount || 0,
      thinkingTokens: usageMetadata?.thoughtsTokenCount,
    };

    // Parse finish reason
    const finishReason = this.parseFinishReason(candidate?.finishReason as string);

    return {
      id: generateResponseId(),
      model,
      content: text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      finishReason,
      thinking: thinking || undefined,
      provider: 'gemini',
    };
  }

  private *parseStreamChunk(
    data: Record<string, unknown>,
    totalUsage: TokenUsage
  ): Generator<StreamChunk> {
    const candidate = (data.candidates as unknown[])?.[0] as Record<string, unknown> | undefined;
    const content = candidate?.content as Record<string, unknown> | undefined;
    const parts = (content?.parts as unknown[]) || [];

    for (const part of parts as Record<string, unknown>[]) {
      if (part.text) {
        yield { type: 'text', content: part.text as string };
      }
      if (part.functionCall) {
        const fc = part.functionCall as Record<string, unknown>;
        yield {
          type: 'tool_call',
          toolCall: {
            id: generateToolCallId(),
            name: fc.name as string,
            arguments: (fc.args as Record<string, unknown>) || {},
          },
        };
      }
      if (part.thought) {
        yield { type: 'thinking', content: part.thought as string };
      }
    }

    // Update usage
    const usageMetadata = data.usageMetadata as Record<string, number> | undefined;
    if (usageMetadata) {
      totalUsage.promptTokens = usageMetadata.promptTokenCount || 0;
      totalUsage.completionTokens = usageMetadata.candidatesTokenCount || 0;
      totalUsage.totalTokens = usageMetadata.totalTokenCount || 0;
    }
  }

  private parseFinishReason(reason?: string): FinishReason {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
        return 'content_filter';
      case 'TOOL_CODE':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }

  // ============================================
  // TOKEN COUNTING
  // ============================================

  async countTokens(text: string, model?: string): Promise<number> {
    const modelId = model || this.getModel({ messages: [] });
    const url = `${this.baseUrl}/models/${modelId}:countTokens?key=${this.apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
        }),
      });

      if (!response.ok) {
        return this.estimateTokens(text);
      }

      const data = await response.json();
      return data.totalTokens || this.estimateTokens(text);
    } catch {
      return this.estimateTokens(text);
    }
  }
}
