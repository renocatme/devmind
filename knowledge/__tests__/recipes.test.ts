import { describe, it, expect } from 'vitest';
import { KnowledgeBase } from '../KnowledgeBase';
import { loadRecipes } from '../RecipeLoader';
import path from 'path';

describe('Recipe loader', () => {
  it('loads recipes.jsonl into KB with metadata.recipe', async () => {
    const kb = new KnowledgeBase();
    const jsonlPath = path.join(process.cwd(), 'docs', 'knowledge', 'recipes.jsonl');

    await loadRecipes(kb, jsonlPath);

    const docs = kb.getAllDocuments();
    expect(docs.length).toBeGreaterThanOrEqual(2);
    const recipeDoc = docs.find(d => d.path === 'recipes/recipe_run_tests');
    expect(recipeDoc).toBeDefined();
    expect(recipeDoc?.metadata.recipe).toBeDefined();
    expect(recipeDoc?.metadata.recipe.intent).toBe('run-tests');
  });
});
