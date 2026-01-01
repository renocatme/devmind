import { KnowledgeBase } from '../knowledge/KnowledgeBase';
import { createConfig } from '../sdk/config';
import { createClient } from '../sdk/client';

/**
 * Explain a code file using the KnowledgeBase to assemble context and
 * an LLM (when available) to generate a richer explanation.
 * If no LLM provider is configured in the environment, falls back to KB context.
 */
export async function explainFile(
  kb: KnowledgeBase,
  path: string,
  content: string,
  client?: any
): Promise<string> {
  // Ensure the code is indexed into KB
  kb.addCode(content, path);

  const query = `explain the code in ${path}`;
  const res = kb.query({ query, topK: 5, threshold: 0 });

  // Assemble a concise context for the LLM
  const context = res.context || '';
  const excerpt = content.length > 3000 ? content.slice(0, 3000) + '\n...[truncated]' : content;

  // If a client was provided (for tests or runtime), use it. Otherwise try to build one
  // from browser globals. Any failure falls back to KB context.
  try {
    const activeClient = client || (() => {
      const geminiKey = (typeof window !== 'undefined' && (window as any).GEMINI_API_KEY) || undefined;
      const openaiKey = (typeof window !== 'undefined' && (window as any).OPENAI_API_KEY) || undefined;
      const anthropicKey = (typeof window !== 'undefined' && (window as any).ANTHROPIC_API_KEY) || undefined;
      const ollamaUrl = (typeof window !== 'undefined' && (window as any).OLLAMA_BASE_URL) || undefined;

      if (!geminiKey && !openaiKey && !anthropicKey && !ollamaUrl) return undefined;

      const cfg = createConfig({
        geminiKey: geminiKey || undefined,
        openaiKey: openaiKey || undefined,
        anthropicKey: anthropicKey || undefined,
        ollamaUrl: ollamaUrl || undefined,
        defaultProvider: openaiKey ? 'openai' : geminiKey ? 'gemini' : undefined,
      } as any);

      return createClient(cfg);
    })();

    if (activeClient && activeClient.askWithSystem) {
      const systemPrompt = `You are an expert software engineer. Provide a concise, structured explanation of the file, including: a short summary, main functions/classes, potential bugs or edge-cases, complexity/risks, and suggested tests or improvements.`;
      const userPrompt = `File: ${path}\n\nContext:\n${context}\n\nFile content (truncated):\n${excerpt}\n\nPlease give a clear, actionable explanation.`;

      const reply = await activeClient.askWithSystem(systemPrompt, userPrompt, { maxTokens: 800 });
      if (reply && reply.length > 0) return reply;
    }
  } catch (e) {
    // Fallthrough to KB-based explanation
    try { console.warn('LLM explainFile failed or not configured:', e); } catch {}
  }

  if (res && res.documents && res.documents.length > 0) {
    return res.context || 'No explanation available';
  }

  return 'No explanation found';
}

export default { explainFile };
