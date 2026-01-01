import { describe, it, expect } from 'vitest';
import { explainFile } from '../codeAnalysis';
import { KnowledgeBase } from '../../knowledge/KnowledgeBase';

describe('codeAnalysis.explainFile', () => {
  it('returns explanation from KB context', async () => {
    const kb = new KnowledgeBase();
    const content = 'function add(a,b){ return a+b }';
    const result = await explainFile(kb, '/sum.js', content);
    // Since KB will index and return context (may be small), ensure a string is returned
    expect(typeof result).toBe('string');
  });
});
