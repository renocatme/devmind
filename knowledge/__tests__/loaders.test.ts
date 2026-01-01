import { describe, it, expect } from 'vitest';
import { KnowledgeBase } from '../KnowledgeBase';
import { loadMarkdownFile, loadMarkdownDir } from '../MarkdownLoader';
import { loadJSONL } from '../JSONLLoader';
import path from 'path';

describe('Knowledge loaders', () => {
  it('loads markdown files into KB', async () => {
    const kb = new KnowledgeBase();
    const mdPath = path.join(process.cwd(), 'docs', 'knowledge', 'setup.md');
    await loadMarkdownFile(kb, mdPath);

    const docs = kb.getAllDocuments();
    expect(docs.length).toBeGreaterThan(0);
    const found = docs.find(d => d.path === mdPath);
    expect(found).toBeDefined();
    expect(found?.metadata.title).toBe('Project Setup Guide');
  });

  it('loads JSONL corpus into KB', async () => {
    const kb = new KnowledgeBase();
    const jsonlPath = path.join(process.cwd(), 'docs', 'knowledge', 'corpus.jsonl');
    await loadJSONL(kb, jsonlPath);

    const docs = kb.getAllDocuments();
    expect(docs.length).toBeGreaterThanOrEqual(2);
    const titles = docs.map(d => d.metadata.title || '').filter(Boolean);
    expect(titles).toEqual(expect.arrayContaining(['Project Setup', 'Troubleshooting']));
  });
});
