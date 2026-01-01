import fs from 'fs';
import readline from 'readline';
import { KnowledgeBase } from './KnowledgeBase';

/**
 * Load newline-delimited JSON (JSONL) where each line is a record with
 * fields: id?, text, metadata?
 */
export async function loadJSONL(kb: KnowledgeBase, filePath: string, scope?: 'platform' | 'project') {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const text = obj.text || obj.content || '';
      const path = obj.path || (obj.id ? `jsonl_${obj.id}` : `jsonl_${Date.now()}`);
      const metadata = obj.metadata || {};
      // Build a minimal document string by merging metadata title and text
      const content = (metadata.title ? `${metadata.title}\n\n` : '') + text;
      const doc = kb.addDocument(content, path, 'text');
      // Propagate metadata fields into the stored document
      if (metadata.title) doc.metadata.title = metadata.title;
      if (metadata.tags) doc.metadata.tags = metadata.tags;
      if (metadata.type) doc.metadata.provider = metadata.type;
      if (scope) doc.metadata.scope = scope;
    } catch (e) {
      // skip invalid lines
    }
  }
}
