/**
 * DevMind Multi-Provider LLM SDK - Type Definitions
 */

// ============================================
// PROVIDER TYPES
// ============================================

export type ProviderName = 'gemini' | 'openai' | 'anthropic' | 'ollama';

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
}

export interface ProviderConfig {
  name: ProviderName;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  rateLimit?: RateLimitConfig;
  timeout?: number;
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  tokensPerMinute?: number;
}

// ============================================
// MESSAGE TYPES
// ============================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  content: string | ContentPart[];
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ContentPart {
  type: 'text' | 'image' | 'audio';
  text?: string;
  imageUrl?: string;
  imageBase64?: string;
  mimeType?: string;
}

// ============================================
// CHAT REQUEST/RESPONSE
// ============================================

export interface ChatRequest {
  messages: Message[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoiceOption;
  systemPrompt?: string;
  responseFormat?: ResponseFormat;
  stopSequences?: string[];
}

export type ToolChoiceOption = 'auto' | 'none' | 'required' | { name: string };

export interface ResponseFormat {
  type: 'text' | 'json_object' | 'json_schema';
  schema?: Record<string, unknown>;
}

export interface ChatResponse {
  id: string;
  model: string;
  content: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  finishReason: FinishReason;
  thinking?: string;
  provider: ProviderName;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  thinkingTokens?: number;
}

export type FinishReason = 
  | 'stop' 
  | 'length' 
  | 'tool_calls' 
  | 'content_filter' 
  | 'error';

// ============================================
// STREAMING TYPES
// ============================================

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'thinking' | 'usage' | 'done' | 'error';
  content?: string;
  toolCall?: Partial<ToolCall>;
  usage?: TokenUsage;
  error?: string;
}

export interface StreamOptions {
  onText?: (text: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onThinking?: (thinking: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}

// ============================================
// TOOL TYPES
// ============================================

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute?: ToolExecutor;
}

export type ToolExecutor = (
  args: Record<string, unknown>,
  context?: ToolContext
) => Promise<string>;

export interface ToolContext {
  sessionId?: string;
  fileSystem?: unknown;
  terminal?: unknown;
  [key: string]: unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  result: string;
  isError?: boolean;
}

// ============================================
// JSON SCHEMA (Simplified)
// ============================================

export interface JSONSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  items?: JSONSchemaProperty;
  description?: string;
  enum?: (string | number | boolean)[];
}

export interface JSONSchemaProperty {
  type: string | string[];
  description?: string;
  enum?: (string | number | boolean)[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  default?: unknown;
}

// ============================================
// CLIENT CONFIGURATION
// ============================================

export interface ClientConfig {
  providers: ProviderConfig[];
  defaultProvider: ProviderName;
  defaultModel?: string;
  retryConfig?: RetryConfig;
  debug?: boolean;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

// ============================================
// ERROR TYPES
// ============================================

export enum ErrorCode {
  RATE_LIMIT = 'RATE_LIMIT',
  INVALID_API_KEY = 'INVALID_API_KEY',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  CONTEXT_LENGTH_EXCEEDED = 'CONTEXT_LENGTH_EXCEEDED',
  CONTENT_FILTERED = 'CONTENT_FILTERED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  INVALID_REQUEST = 'INVALID_REQUEST',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  UNKNOWN = 'UNKNOWN',
}

// ============================================
// PROVIDER INTERFACE
// ============================================

export interface LLMProvider {
  readonly name: ProviderName;
  readonly models: ModelInfo[];
  
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncGenerator<StreamChunk>;
  
  countTokens?(text: string, model?: string): Promise<number>;
  validateApiKey?(): Promise<boolean>;
  listModels?(): Promise<ModelInfo[]>;
}

// ============================================
// KNOWLEDGE BASE TYPES
// ============================================

export interface KnowledgeDocument {
  id: string;
  type: 'markdown' | 'code' | 'json' | 'text';
  path: string;
  content: string;
  metadata: DocumentMetadata;
  embedding?: number[];
}

export interface DocumentMetadata {
  title?: string;
  language?: string;
  tags?: string[];
  provider?: ProviderName;
  lastModified?: number;
  size?: number;
}

export interface RAGQuery {
  query: string;
  topK?: number;
  filter?: DocumentFilter;
  includeContent?: boolean;
}

export interface DocumentFilter {
  types?: KnowledgeDocument['type'][];
  providers?: ProviderName[];
  tags?: string[];
  paths?: string[];
}

export interface RAGResult {
  documents: KnowledgeDocument[];
  scores: number[];
  context: string;
}
