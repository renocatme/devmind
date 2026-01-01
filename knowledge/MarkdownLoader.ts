import fs from 'fs';
import path from 'path';
import { KnowledgeBase } from './KnowledgeBase';

/**
 * Simple Markdown loader that reads a file or directory and adds markdown documents to the KB.
 */
export async function loadMarkdownFile(kb: KnowledgeBase, filePath: string, scope?: 'platform' | 'project') {
  const content = fs.readFileSync(filePath, 'utf8');
  const doc = kb.addMarkdown(content, filePath);
  if (scope) doc.metadata.scope = scope;
  return doc;
}

export async function loadMarkdownDir(kb: KnowledgeBase, dirPath: string, scope?: 'platform' | 'project') {
  const entries = fs.readdirSync(dirPath);
  for (const entry of entries) {
    const full = path.join(dirPath, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      await loadMarkdownDir(kb, full, scope);
    } else if (entry.endsWith('.md') || entry.endsWith('.mdx')) {
      await loadMarkdownFile(kb, full, scope);
    }
  }
}
