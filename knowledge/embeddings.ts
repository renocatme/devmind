/**
 * Simple deterministic embedding generator for local testing.
 * Not a production embedding; used for unit tests and in-memory RAG.
 */
export function generateEmbedding(text: string, dim = 64): number[] {
  const embedding = new Array<number>(dim).fill(0);
  if (!text) return embedding;

  // Normalize
  const s = text.toLowerCase();

  // Simple rolling hash contributions
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    for (let j = 0; j < dim; j++) {
      // mix position, char code and j to get variety
      embedding[j] += ((code * (i + 1)) % (j + 31)) / (j + 1);
    }
  }

  // Normalize to unit vector
  let norm = 0;
  for (let k = 0; k < dim; k++) {
    norm += embedding[k] * embedding[k];
  }
  norm = Math.sqrt(norm) || 1;
  for (let k = 0; k < dim; k++) embedding[k] = embedding[k] / norm;

  return embedding;
}
