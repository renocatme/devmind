import { expect, test } from 'vitest';
import { KnowledgeBase } from '../KnowledgeBase';
import { generateEmbedding } from '../embeddings';
import fs from 'fs';

const TMP_INDEX = 'tmp_kb_index.json';

test('exportIndex and importIndex persist embeddings to disk', async () => {
  const kb = new KnowledgeBase();

  const doc = kb.addDocument('Persistence test document about AI', 'docs/persist.md', 'markdown');

  const emb = generateEmbedding(doc.content, 32);
  await kb.setEmbedding(doc.id, emb);

  // Ensure embedding present
  expect(kb['index'].embeddings.has(doc.id)).toBe(true);

  // Export index
  kb.exportIndex(TMP_INDEX);
  expect(fs.existsSync(TMP_INDEX)).toBe(true);

  // Clear embeddings and import
  kb['index'].embeddings.clear();
  expect(kb['index'].embeddings.size).toBe(0);

  kb.importIndex(TMP_INDEX);
  expect(kb['index'].embeddings.has(doc.id)).toBe(true);

  // Cleanup
  try { fs.unlinkSync(TMP_INDEX); } catch {}
});
