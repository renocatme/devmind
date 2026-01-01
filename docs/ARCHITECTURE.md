# DevMind Architecture Documentation

## Overview

DevMind is an AI Development Engineer / Autonomous Agent IDE with:
- **Multi-Provider LLM SDK** - Custom abstraction layer for multiple AI providers
- **Agent Collaborator System** - Multi-agent architecture with autonomous RAG
- **WebContainer Runtime** - Browser-based Node.js execution environment
- **Gemini CLI Integration** - Terminal integration with Google's Gemini CLI

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DevMind Application                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │   Chat Interface │  │   Code Editor    │  │   Terminal Panel     │   │
│  │   (Agent UI)     │  │   (Monaco)       │  │   (xterm.js)         │   │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────┘   │
│           │                     │                       │               │
│           └─────────────────────┼───────────────────────┘               │
│                                 │                                        │
│  ┌──────────────────────────────┴──────────────────────────────────┐    │
│  │                     Session Context                              │    │
│  │  (State Management: Files, Packages, Messages, Agent Profile)    │    │
│  └──────────────────────────────┬──────────────────────────────────┘    │
│                                 │                                        │
├─────────────────────────────────┼────────────────────────────────────────┤
│                                 │                                        │
│  ┌──────────────────────────────┴──────────────────────────────────┐    │
│  │                    Agent Orchestrator                            │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │    │
│  │  │ Orchestrator│  │  Coder      │  │  Debugger   │              │    │
│  │  │   Agent     │  │  Agent      │  │  Agent      │              │    │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │    │
│  │         └────────────────┼────────────────┘                      │    │
│  │                          │                                       │    │
│  │  ┌───────────────────────┴───────────────────────────────────┐  │    │
│  │  │                  Knowledge Base (RAG)                      │  │    │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │  │    │
│  │  │  │  Markdown   │  │   Corpus    │  │  Provider   │        │  │    │
│  │  │  │  Documents  │  │   Files     │  │  Specific   │        │  │    │
│  │  │  └─────────────┘  └─────────────┘  └─────────────┘        │  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  └──────────────────────────────┬──────────────────────────────────┘    │
│                                 │                                        │
├─────────────────────────────────┼────────────────────────────────────────┤
│                                 │                                        │
│  ┌──────────────────────────────┴──────────────────────────────────┐    │
│  │                    Multi-Provider SDK                            │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │    │
│  │  │   Gemini    │  │   OpenAI    │  │  Anthropic  │              │    │
│  │  │  Provider   │  │  Provider   │  │  Provider   │              │    │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │    │
│  │         └────────────────┼────────────────┘                      │    │
│  │                          │                                       │    │
│  │  ┌───────────────────────┴───────────────────────────────────┐  │    │
│  │  │              Unified LLM Interface                         │  │    │
│  │  │  - Streaming Support                                       │  │    │
│  │  │  - Tool/Function Calling                                   │  │    │
│  │  │  - Context Management                                      │  │    │
│  │  │  - Error Handling & Fallbacks                              │  │    │
│  │  └───────────────────────────────────────────────────────────┘  │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Runtime Layer                                  │   │
│  │  ┌─────────────────────────┐  ┌─────────────────────────────┐    │   │
│  │  │    WebContainer         │  │    Gemini CLI Integration   │    │   │
│  │  │    (Browser Runtime)    │  │    (Terminal Commands)      │    │   │
│  │  │                         │  │                             │    │   │
│  │  │  - Node.js Execution    │  │  - Shell Commands           │    │   │
│  │  │  - File System          │  │  - AI-Assisted Terminal     │    │   │
│  │  │  - Package Manager      │  │  - Code Analysis            │    │   │
│  │  │  - Process Management   │  │  - File Operations          │    │   │
│  │  └─────────────────────────┘  └─────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Multi-Provider SDK (`/sdk`)

Custom abstraction layer for multiple LLM providers:

```typescript
// Provider Interface
interface LLMProvider {
  name: string;
  sendMessage(messages: Message[], options: LLMOptions): Promise<LLMResponse>;
  streamMessage(messages: Message[], options: LLMOptions): AsyncGenerator<string>;
  callTool(tool: ToolCall, context: AgentContext): Promise<ToolResult>;
}

// Supported Providers
- GeminiProvider (Google Gemini API)
- OpenAIProvider (OpenAI GPT models)
- AnthropicProvider (Claude models)
- OllamaProvider (Local models)
```

### 2. Agent Collaborator System (`/agents`)

Multi-agent architecture with specialized roles:

```typescript
// Agent Roles
- Orchestrator: Routes tasks, manages workflow
- Coder: Writes and modifies code
- Debugger: Analyzes and fixes issues
- Researcher: Gathers information, RAG queries
- Reviewer: Code review and quality checks
```

### 3. Knowledge Base / RAG (`/knowledge`)

Autonomous RAG system with provider-specific knowledge:

```typescript
// Knowledge Sources
- Markdown documents (project docs, README)
- Code corpus (codebase analysis)
- Provider-specific knowledge (API docs, best practices)
- Session context (conversation history)
```

### 4. WebContainer Runtime (`/runtime/webcontainer`)

Browser-based Node.js execution:

```typescript
// WebContainer Features
- Full Node.js runtime in browser
- Virtual file system
- Package installation (npm)
- Process spawning
- Terminal integration
```

### 5. Gemini CLI Integration (`/runtime/gemini-cli`)

Terminal integration with Google's Gemini CLI:

```typescript
// Gemini CLI Features
- AI-assisted shell commands
- Code analysis and explanation
- File operations with AI context
- Interactive debugging
```

---

## Data Flow

```
User Input → Chat Interface → Session Context
                                    ↓
                            Agent Orchestrator
                                    ↓
                    ┌───────────────┼───────────────┐
                    ↓               ↓               ↓
              Knowledge Base   LLM Provider    Tool Registry
                    ↓               ↓               ↓
                    └───────────────┼───────────────┘
                                    ↓
                            Agent Response
                                    ↓
                    ┌───────────────┼───────────────┐
                    ↓               ↓               ↓
              File System      Terminal       Preview Pane
                    ↓               ↓               ↓
                    └───────────────┼───────────────┘
                                    ↓
                            WebContainer Runtime
```

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite |
| UI Components | Tailwind CSS, Lucide Icons |
| Code Editor | Monaco Editor |
| Terminal | xterm.js |
| 3D Visualization | Three.js, React Three Fiber |
| Runtime | WebContainer API |
| LLM Providers | Gemini, OpenAI, Anthropic, Ollama |
| State Management | React Context + Hooks |
| Storage | LocalStorage, IndexedDB |

---

## Security Considerations

1. **API Key Management**: Keys stored securely, never exposed to client
2. **Sandbox Isolation**: WebContainer runs in isolated environment
3. **Input Validation**: All user inputs sanitized
4. **CORS Configuration**: Proper cross-origin policies
5. **Rate Limiting**: Provider-specific rate limit handling

---

## Performance Optimizations

1. **Lazy Loading**: Components loaded on demand
2. **Streaming Responses**: Real-time LLM output
3. **Caching**: Knowledge base and API responses cached
4. **Virtual File System**: Efficient in-memory operations
5. **Web Workers**: Heavy computations offloaded
