/**
 * AI-assisted terminal skeleton. Real LLM integration should be added later.
 */

export interface CommandSuggestion {
  command: string;
  score: number;
  reason?: string;
}

export async function suggestCommands(prompt: string, limit = 3): Promise<CommandSuggestion[]> {
  // Placeholder deterministic suggestions for tests — replace with LLM call
  const suggestions: CommandSuggestion[] = [];
  if (prompt.includes('install')) {
    suggestions.push({ command: 'npm install', score: 0.9, reason: 'Install dependencies' });
  }
  if (prompt.includes('run')) {
    suggestions.push({ command: 'npm run dev', score: 0.8, reason: 'Start dev server' });
  }
  if (suggestions.length === 0) {
    suggestions.push({ command: 'echo "No suggestion"', score: 0.1 });
  }
  return suggestions.slice(0, limit);
}

export default { suggestCommands };
