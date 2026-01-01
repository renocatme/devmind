# Multi-Provider LLM SDK Design

## Overview

The DevMind SDK provides a unified interface for interacting with multiple LLM providers. This document outlines the design principles, interfaces, and implementation details.

---

## Design Principles

1. **Provider Agnostic**: Same API regardless of underlying provider
2. **Type Safe**: Full TypeScript support with strict typing
3. **Streaming First**: Native support for streaming responses
4. **Tool Calling**: Unified function/tool calling interface
5. **Error Handling**: Consistent error types across providers
6. **Extensible**: Easy to add new providers

---

## Directory Structure

```
/sdk
├── index.ts                 # Main exports
├── types.ts                 # Shared types and interfaces
├── client.ts                # LLMClient main class
├── config.ts                # Configuration management
├── errors.ts                # Error types
├── providers/
│   ├── index.ts             # Provider exports
│   ├── base.ts              # Base provider class
│   ├── gemini.ts            # Gemini provider
│   ├── openai.ts            # OpenAI provider
│   ├── anthropic.ts         # Anthropic provider
│   └── ollama.ts            # Ollama provider
├── tools/
│   ├── index.ts             # Tool exports
│   ├── types.ts             # Tool types
│   └── registry.ts          # Tool registry
└── utils/
    ├── streaming.ts         # Streaming utilities
    ├── retry.ts             # Retry logic
    └── rate-limit.ts        # Rate limiting
```

---

## Core Interfaces

### LLMProvider Interface

```typescript
interface LLMProvider {
  readonly name: ProviderName;
  readonly models: ModelInfo[];
  
  // Core methods
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncGenerator<StreamChunk>;
  
  // Tool calling
  callTools(tools: ToolDefinition[]): ToolConfig;
  
  // Utilities
  countTokens(text: string): Promise<number>;
  validateApiKey(): Promise<boolean>;
}
```

### Message Types

```typescript
type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

interface Message {
  role: MessageRole;
  content: string | ContentPart[];
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

interface ContentPart {
  type: 'text' | 'image' | 'audio';
  text?: string;
  imageUrl?: string;
  imageBase64?: string;
  mimeType?: string;
}
```

### Chat Request/Response

```typescript
interface ChatRequest {
  messages: Message[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | ToolChoice;
  systemPrompt?: string;
  responseFormat?: ResponseFormat;
}

interface ChatResponse {
  id: string;
  model: string;
  content: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  finishReason: FinishReason;
  thinking?: string; // For models with reasoning
}

interface StreamChunk {
  type: 'text' | 'tool_call' | 'thinking' | 'done';
  content?: string;
  toolCall?: Partial<ToolCall>;
  usage?: TokenUsage;
}
```

### Tool Definitions

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute?: (args: Record<string, unknown>) => Promise<string>;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolResult {
  toolCallId: string;
  result: string;
  isError?: boolean;
}
```

---

## Provider Implementations

### Base Provider

```typescript
abstract class BaseProvider implements LLMProvider {
  protected config: ProviderConfig;
  protected rateLimiter: RateLimiter;
  
  constructor(config: ProviderConfig) {
    this.config = config;
    this.rateLimiter = new RateLimiter(config.rateLimit);
  }
  
  abstract chat(request: ChatRequest): Promise<ChatResponse>;
  abstract stream(request: ChatRequest): AsyncGenerator<StreamChunk>;
  
  protected async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    return retry(fn, this.config.retryConfig);
  }
  
  protected async checkRateLimit(): Promise<void> {
    await this.rateLimiter.acquire();
  }
}
```

### Gemini Provider

```typescript
class GeminiProvider extends BaseProvider {
  private client: GoogleGenAI;
  
  readonly name = 'gemini';
  readonly models = [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1000000 },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1000000 },
    { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', contextWindow: 2000000 },
  ];
  
  async chat(request: ChatRequest): Promise<ChatResponse> {
    await this.checkRateLimit();
    
    const model = this.client.getGenerativeModel({
      model: request.model || 'gemini-2.5-pro',
      systemInstruction: request.systemPrompt,
    });
    
    const chat = model.startChat({
      history: this.convertMessages(request.messages),
      tools: request.tools ? this.convertTools(request.tools) : undefined,
    });
    
    const result = await chat.sendMessage(
      this.getLastUserMessage(request.messages)
    );
    
    return this.convertResponse(result);
  }
  
  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    // Streaming implementation
  }
}
```

### OpenAI Provider

```typescript
class OpenAIProvider extends BaseProvider {
  private client: OpenAI;
  
  readonly name = 'openai';
  readonly models = [
    { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000 },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000 },
  ];
  
  async chat(request: ChatRequest): Promise<ChatResponse> {
    await this.checkRateLimit();
    
    const response = await this.client.chat.completions.create({
      model: request.model || 'gpt-4o',
      messages: this.convertMessages(request.messages),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      tools: request.tools ? this.convertTools(request.tools) : undefined,
      tool_choice: request.toolChoice,
    });
    
    return this.convertResponse(response);
  }
}
```

### Anthropic Provider

```typescript
class AnthropicProvider extends BaseProvider {
  private client: Anthropic;
  
  readonly name = 'anthropic';
  readonly models = [
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', contextWindow: 200000 },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', contextWindow: 200000 },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', contextWindow: 200000 },
  ];
  
  async chat(request: ChatRequest): Promise<ChatResponse> {
    await this.checkRateLimit();
    
    const response = await this.client.messages.create({
      model: request.model || 'claude-3-5-sonnet-20241022',
      system: request.systemPrompt,
      messages: this.convertMessages(request.messages),
      max_tokens: request.maxTokens || 4096,
      tools: request.tools ? this.convertTools(request.tools) : undefined,
    });
    
    return this.convertResponse(response);
  }
}
```

### Ollama Provider

```typescript
class OllamaProvider extends BaseProvider {
  private baseUrl: string;
  
  readonly name = 'ollama';
  
  get models(): ModelInfo[] {
    // Dynamically fetch available models
    return this.fetchModels();
  }
  
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model || 'llama3.2',
        messages: this.convertMessages(request.messages),
        stream: false,
      }),
    });
    
    return this.convertResponse(await response.json());
  }
}
```

---

## LLM Client

```typescript
class LLMClient {
  private providers: Map<ProviderName, LLMProvider>;
  private activeProvider: LLMProvider;
  private config: ClientConfig;
  
  constructor(config: ClientConfig) {
    this.config = config;
    this.providers = new Map();
    this.initializeProviders();
  }
  
  // Provider management
  setProvider(name: ProviderName): void {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`Provider ${name} not configured`);
    this.activeProvider = provider;
  }
  
  getProvider(name?: ProviderName): LLMProvider {
    return name ? this.providers.get(name)! : this.activeProvider;
  }
  
  // Chat methods
  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.activeProvider.chat(request);
  }
  
  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    yield* this.activeProvider.stream(request);
  }
  
  // Tool execution
  async executeTools(
    response: ChatResponse,
    tools: ToolDefinition[]
  ): Promise<ToolResult[]> {
    if (!response.toolCalls) return [];
    
    const results: ToolResult[] = [];
    for (const call of response.toolCalls) {
      const tool = tools.find(t => t.name === call.name);
      if (!tool?.execute) continue;
      
      try {
        const result = await tool.execute(call.arguments);
        results.push({ toolCallId: call.id, result });
      } catch (error) {
        results.push({
          toolCallId: call.id,
          result: `Error: ${error.message}`,
          isError: true,
        });
      }
    }
    
    return results;
  }
  
  // Agentic loop
  async runAgentLoop(
    request: ChatRequest,
    tools: ToolDefinition[],
    maxIterations = 10
  ): Promise<ChatResponse> {
    let messages = [...request.messages];
    let iterations = 0;
    
    while (iterations < maxIterations) {
      const response = await this.chat({ ...request, messages, tools });
      
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
      const results = await this.executeTools(response, tools);
      for (const result of results) {
        messages.push({
          role: 'tool',
          content: result.result,
          toolCallId: result.toolCallId,
        });
      }
      
      iterations++;
    }
    
    throw new Error('Max iterations reached');
  }
}
```

---

## Configuration

```typescript
interface ClientConfig {
  providers: ProviderConfig[];
  defaultProvider: ProviderName;
  defaultModel?: string;
  retryConfig?: RetryConfig;
}

interface ProviderConfig {
  name: ProviderName;
  apiKey?: string;
  baseUrl?: string;
  models?: string[];
  rateLimit?: RateLimitConfig;
}

// Example configuration
const config: ClientConfig = {
  defaultProvider: 'gemini',
  providers: [
    {
      name: 'gemini',
      apiKey: process.env.GEMINI_API_KEY,
    },
    {
      name: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
    },
    {
      name: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
    {
      name: 'ollama',
      baseUrl: 'http://localhost:11434',
    },
  ],
};
```

---

## Error Handling

```typescript
class LLMError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public provider: ProviderName,
    public retryable: boolean = false
  ) {
    super(message);
  }
}

enum ErrorCode {
  RATE_LIMIT = 'RATE_LIMIT',
  INVALID_API_KEY = 'INVALID_API_KEY',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  CONTEXT_LENGTH_EXCEEDED = 'CONTEXT_LENGTH_EXCEEDED',
  CONTENT_FILTERED = 'CONTENT_FILTERED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN = 'UNKNOWN',
}
```

---

## Usage Examples

### Basic Chat

```typescript
const client = new LLMClient(config);

const response = await client.chat({
  messages: [
    { role: 'user', content: 'Hello, how are you?' }
  ],
});

console.log(response.content);
```

### Streaming

```typescript
for await (const chunk of client.stream({ messages })) {
  if (chunk.type === 'text') {
    process.stdout.write(chunk.content);
  }
}
```

### Tool Calling

```typescript
const tools: ToolDefinition[] = [
  {
    name: 'get_weather',
    description: 'Get current weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string' },
      },
      required: ['location'],
    },
    execute: async (args) => {
      return `Weather in ${args.location}: Sunny, 72°F`;
    },
  },
];

const response = await client.runAgentLoop(
  { messages: [{ role: 'user', content: 'What\'s the weather in Tokyo?' }] },
  tools
);
```

### Provider Switching

```typescript
// Use Gemini
client.setProvider('gemini');
const geminiResponse = await client.chat({ messages });

// Switch to OpenAI
client.setProvider('openai');
const openaiResponse = await client.chat({ messages });

// Use specific provider for one request
const claudeResponse = await client.getProvider('anthropic').chat({ messages });
```
