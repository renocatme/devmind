import fs from 'fs';
import readline from 'readline';
import { KnowledgeBase } from './KnowledgeBase';

/**
 * Load newline-delimited JSON recipes (recipes.jsonl). Each line should be an
 * action recipe with fields: id, intent, triggers, commands, verify, rollback, etc.
 * 
 * Loader will store a human-readable summary into the KB and attach the structured
 * recipe under `doc.metadata.recipe` for agent consumption.
 */
export async function loadRecipes(kb: KnowledgeBase, filePath: string, scope?: 'platform' | 'project') {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);

      const title = obj.title || obj.id || obj.intent || 'recipe';
      // Build human summary
      const lines: string[] = [];
      lines.push(`# ${title}`);
      if (obj.intent) lines.push(`**Intent:** ${obj.intent}`);
      if (obj.triggers) lines.push(`**Triggers:** ${JSON.stringify(obj.triggers)}`);
      if (obj.commands) {
        lines.push('**Commands:**');
        for (const c of obj.commands) {
          lines.push(`- ${c.cmd} (cwd: ${c.cwd || '.'})`);
        }
      }
      if (obj.verify) {
        lines.push('**Verify:**');
        for (const v of obj.verify) lines.push(`- ${v.cmd} => ${v.assert || ''}`);
      }
      if (obj.rollback) {
        lines.push('**Rollback:**');
        for (const r of obj.rollback) lines.push(`- ${r.cmd}`);
      }

      const content = lines.join('\n');
      const path = `recipes/${obj.id}`;
      const doc = kb.addDocument(content, path, 'text');
      doc.metadata.recipe = obj;
      if (obj.tags) doc.metadata.tags = obj.tags;
      if (obj.title) doc.metadata.title = obj.title;
      if (scope) doc.metadata.scope = scope;
    } catch (e) {
      // ignore malformed recipe
    }
  }
}
