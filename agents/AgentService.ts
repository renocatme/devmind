/**
 * Agent Service - Unified agent interface using the Multi-Provider SDK
 */

import {
  LLMClient,
  createGeminiOnlyConfig,
  ToolDefinition,
  Message as SDKMessage,
  JSONSchema,
} from '../sdk';
import { AgentProfile, AgentRole, AgentContext, ToolCall, Message, Sender } from '../types';
import { ALL_TOOLS } from '../services/toolsRegistry';
import { createRouterTools } from '../lib/router_tools';
import { KnowledgeBase } from '../knowledge';

// ============================================
// TYPES
// ============================================

interface AgentServiceConfig {
  apiKey: string;
  model?: string;
  thinkingBudget?: number;
  knowledgeBase?: KnowledgeBase;
  concurrencyLimit?: number;
}

interface SendMessageCallbacks {
  onStream: (chunk: string) => void;
  onToolStart: (tool: ToolCall) => void;
  onToolEnd: (toolId: string, result: string) => void;
  onThinking?: (thinking: string) => void;
}

// ============================================
// AGENT SERVICE
// ============================================

export class AgentService {
  private client: LLMClient;
  private model: string;
  private knowledgeBase?: KnowledgeBase;
  private concurrencyLimit: number;

  constructor(config: AgentServiceConfig) {
    this.client = new LLMClient(
      createGeminiOnlyConfig(config.apiKey)
    );
    this.model = config.model || 'gemini-3-pro-preview';
    this.knowledgeBase = config.knowledgeBase;
    this.concurrencyLimit = config.concurrencyLimit || 3;
  }

  // ============================================
  // MAIN SEND MESSAGE
  // ============================================

  async sendMessage(
    messages: Message[],
    context: AgentContext,
    activeProfile: AgentProfile,
    onSwitchAgent: (role: AgentRole, reason: string) => Promise<string>,
    callbacks: SendMessageCallbacks
  ): Promise<string> {
    const { onStream, onToolStart, onToolEnd, onThinking } = callbacks;

    // Build tools
    const tools = this.buildTools(activeProfile, context, onSwitchAgent);

    // Convert messages to SDK format
    const sdkMessages = this.convertMessages(messages);

    // Add RAG context if available
    const systemPrompt = await this.buildSystemPrompt(activeProfile, messages);

    try {
      let finalResponse = '';
      let currentMessages = [...sdkMessages];

      // Agent loop
      for (let iteration = 0; iteration < 10; iteration++) {
        const response = await this.client.chat({
          messages: currentMessages,
          model: this.model,
          systemPrompt,
          tools,
          temperature: 0.7,
        });

        // Handle text content
        if (response.content) {
          finalResponse += response.content;
          onStream(response.content);
        }

        // Handle thinking
        if (response.thinking && onThinking) {
          onThinking(response.thinking);
        }

        // No tool calls - we're done
        if (!response.toolCalls?.length) {
          break;
        }

        // Add assistant message
        currentMessages.push({
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls,
        });

        // Execute tools
        for (const call of response.toolCalls) {
          const toolMeta: ToolCall = {
            id: call.id,
            name: call.name,
            args: call.arguments,
          };
          onToolStart(toolMeta);

          let result = 'Error: Tool not found';
          try {
            const tool = tools.find(t => t.name === call.name);
            if (tool?.execute) {
              result = await tool.execute(call.arguments, context as unknown as Record<string, unknown>);
            }
          } catch (e) {
            result = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`;
          }

          onToolEnd(toolMeta.id, result);

          currentMessages.push({
            role: 'tool',
            content: result,
            toolCallId: call.id,
            name: call.name,
          });
        }
      }

      return finalResponse;
    } catch (e) {
      console.error('Agent Error:', e);
      return 'AI Connection Error.';
    }
  }

  // ============================================
  // STREAMING VERSION
  // ============================================

  async *streamMessage(
    messages: Message[],
    context: AgentContext,
    activeProfile: AgentProfile,
    onSwitchAgent: (role: AgentRole, reason: string) => Promise<string>
  ): AsyncGenerator<{
    type: 'text' | 'thinking' | 'tool_start' | 'tool_end' | 'done';
    content?: string;
    tool?: ToolCall;
    result?: string;
  }> {
    const tools = this.buildTools(activeProfile, context, onSwitchAgent);
    const sdkMessages = this.convertMessages(messages);
    const systemPrompt = await this.buildSystemPrompt(activeProfile, messages);

    for await (const event of this.client.runAgentLoopStreaming(
      {
        messages: sdkMessages,
        model: this.model,
        systemPrompt,
        tools,
        temperature: 0.7,
      },
      tools,
      { context: context as unknown as Record<string, unknown> }
    )) {
      switch (event.type) {
        case 'text':
          yield { type: 'text', content: event.content };
          break;
        case 'tool_call':
          yield {
            type: 'tool_start',
            tool: {
              id: `call_${Date.now()}`,
              name: event.toolName!,
              args: event.toolArgs!,
            },
          };
          break;
        case 'tool_result':
          yield {
            type: 'tool_end',
            tool: { id: '', name: event.toolName!, args: {} },
            result: event.toolResult,
          };
          break;
        case 'done':
          yield { type: 'done' };
          break;
      }
    }
  }

  // ============================================
  // TOOL BUILDING
  // ============================================

  private buildTools(
    profile: AgentProfile,
    context: AgentContext,
    onSwitchAgent: (role: AgentRole, reason: string) => Promise<string>
  ): ToolDefinition[] {
    const routerTools = createRouterTools(onSwitchAgent);

    // Convert registry tools to SDK format
    const registryTools = ALL_TOOLS
      .filter(t => profile.allowedTools.includes(t.declaration.name))
      .map(t => ({
        name: t.declaration.name,
        description: t.declaration.description,
        parameters: t.declaration.parameters as unknown as JSONSchema,
        execute: async (args: Record<string, unknown>) => {
          return await t.execute(args, context);
        },
      }));

    // Convert router tools to SDK format
    const sdkRouterTools = routerTools.map(t => ({
      name: t.declaration.name,
      description: t.declaration.description,
      parameters: t.declaration.parameters as unknown as JSONSchema,
      execute: async (args: Record<string, unknown>) => {
        return await t.execute(args);
      },
    }));

    return [...registryTools, ...sdkRouterTools];
  }

  // ============================================
  // MESSAGE CONVERSION
  // ============================================

  private convertMessages(messages: Message[]): SDKMessage[] {
    const sdkMessages: SDKMessage[] = [];

    for (const msg of messages) {
      if (msg.sender === Sender.SYSTEM) continue;

      const role = msg.sender === Sender.USER ? 'user' : 'assistant';
      let content: string | SDKMessage['content'] = msg.text || '';

      // Handle images
      if (msg.image) {
        const [header, base64] = msg.image.split(',');
        const mimeType = header.split(';')[0].split(':')[1];
        content = [
          { type: 'text', text: msg.text || '' },
          { type: 'image', imageBase64: base64, mimeType },
        ];
      }

      // Handle tool calls in history
      if (msg.sender === Sender.AI && msg.toolCalls?.length) {
        sdkMessages.push({
          role: 'assistant',
          content: msg.text || '',
          toolCalls: msg.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.args,
          })),
        });

        // Add tool results
        for (const tc of msg.toolCalls) {
          if (tc.result) {
            sdkMessages.push({
              role: 'tool',
              content: tc.result,
              toolCallId: tc.id,
              name: tc.name,
            });
          }
        }
        continue;
      }

      sdkMessages.push({ role, content });
    }

    // Merge consecutive messages from same role
    const merged: SDKMessage[] = [];
    for (const msg of sdkMessages) {
      const last = merged[merged.length - 1];
      if (last && last.role === msg.role && msg.role !== 'tool') {
        if (typeof last.content === 'string' && typeof msg.content === 'string') {
          last.content += '\n' + msg.content;
        }
      } else {
        merged.push(msg);
      }
    }

    return merged;
  }

  // ============================================
  // SYSTEM PROMPT WITH RAG
  // ============================================

  private async buildSystemPrompt(
    profile: AgentProfile,
    messages: Message[]
  ): Promise<string> {
    let systemPrompt = profile.systemInstruction;

    // Add RAG context if knowledge base is available
    if (this.knowledgeBase) {
      const lastUserMessage = messages
        .filter(m => m.sender === Sender.USER)
        .pop();

      if (lastUserMessage?.text) {
        // Prefer project-scoped docs first, fall back to platform-scoped or any docs
        const projectResult = this.knowledgeBase.query({
          query: lastUserMessage.text,
          topK: 3,
          includeContent: true,
          filter: { scope: 'project' },
        });

        if (projectResult.documents.length > 0) {
          systemPrompt += `\n\n## Relevant Context\n${projectResult.context}`;
        } else {
          const fallback = this.knowledgeBase.query({
            query: lastUserMessage.text,
            topK: 3,
            includeContent: true,
          });
          if (fallback.documents.length > 0) {
            systemPrompt += `\n\n## Relevant Context\n${fallback.context}`;
          }
        }
      }
    }

    return systemPrompt;
  }

  // ============================================
  // PROVIDER MANAGEMENT
  // ============================================

  setProvider(provider: 'gemini' | 'openai' | 'anthropic' | 'ollama'): void {
    this.client.setProvider(provider);
  }

  getAvailableProviders(): string[] {
    return this.client.getAvailableProviders();
  }

  // ============================================
  // KNOWLEDGE BASE
  // ============================================

  setKnowledgeBase(kb: KnowledgeBase): void {
    this.knowledgeBase = kb;
  }

  getKnowledgeBase(): KnowledgeBase | undefined {
    return this.knowledgeBase;
  }

  // ============================================
  // PARALLEL AGENT EXECUTION
  // ============================================

  async runParallelAgents(
    messages: Message[],
    context: AgentContext,
    profiles: AgentProfile[],
    onSwitchAgent: (role: AgentRole, reason: string) => Promise<string>,
    callbacksPerAgent?: Record<string, SendMessageCallbacks>,
    options?: { concurrency?: number }
  ): Promise<Record<string, string>> {
    const concurrency = options?.concurrency || this.concurrencyLimit || 3;

    const results: Record<string, string> = {};
    const queue = [...profiles];

    const worker = async () => {
      while (true) {
        const profile = queue.shift();
        if (!profile) break;

        const callbacks = callbacksPerAgent?.[profile.id] || {
          onStream: (_: string) => {},
          onToolStart: (_: ToolCall) => {},
          onToolEnd: (_: string, __: string) => {},
          onThinking: (_: string) => {},
        };

        try {
          const resp = await this.sendMessage(messages, context, profile, onSwitchAgent, callbacks);
          results[profile.id] = resp;
        } catch (e) {
          results[profile.id] = `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, profiles.length) }, () => worker());
    await Promise.all(workers);

    return results;
  }
}

// ============================================
// FACTORY
// ============================================

let agentServiceInstance: AgentService | null = null;

export function getAgentService(config?: AgentServiceConfig): AgentService {
  if (!agentServiceInstance && config) {
    agentServiceInstance = new AgentService(config);
  }
  if (!agentServiceInstance) {
    throw new Error('AgentService not initialized. Provide config on first call.');
  }
  return agentServiceInstance;
}

export function initAgentService(config: AgentServiceConfig): AgentService {
  agentServiceInstance = new AgentService(config);
  return agentServiceInstance;
}
