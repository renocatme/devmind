import { expect, test } from 'vitest';
import { KnowledgeBase } from '../KnowledgeBase';
import { generateEmbedding } from '../embeddings';

test('semanticSearch returns best matching document using embeddings', async () => {
  const kb = new KnowledgeBase();

  const docA = kb.addDocument('Weather forecast for Tokyo: sunny and warm', 'docs/weather_tokyo.md', 'markdown');
  const docB = kb.addDocument('Installation guide for React and Vite', 'docs/react_setup.md', 'markdown');

  // Create embeddings and set them
  await kb.setEmbedding(docA.id, generateEmbedding(docA.content));
  await kb.setEmbedding(docB.id, generateEmbedding(docB.content));

  // Query embedding similar to docA
  const queryEmbedding = generateEmbedding('What is the weather in Tokyo today?');
  const results = await kb.semanticSearch(queryEmbedding, 2);

  expect(results.length).toBeGreaterThan(0);
  // Best match should be docA
  expect(results[0].document.id).toBe(docA.id);
  expect(results[0].score).toBeGreaterThan(results[1].score);
});
