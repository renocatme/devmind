/**
 * Knowledge Base - Document storage and RAG query system
 */

import {
  Document,
  DocumentType,
  DocumentChunk,
  Corpus,
  RAGQuery,
  RAGResult,
  ScoredDocument,
  SearchIndex,
  KnowledgeBaseConfig,
  QueryFilter,
} from './types';
import { DocumentLoader } from './DocumentLoader';
import fs from 'fs';

// ============================================
// KNOWLEDGE BASE
// ============================================

export class KnowledgeBase {
  private documents: Map<string, Document> = new Map();
  private corpora: Map<string, Corpus> = new Map();
  private index: SearchIndex;
  private loader: DocumentLoader;
  private config: KnowledgeBaseConfig;

  constructor(config: KnowledgeBaseConfig = {}) {
    this.config = {
      maxDocuments: config.maxDocuments || 10000,
      maxChunkSize: config.maxChunkSize || 1000,
      chunkOverlap: config.chunkOverlap || 200,
      ...config,
    };

    this.loader = new DocumentLoader({
      chunkSize: this.config.maxChunkSize,
      chunkOverlap: this.config.chunkOverlap,
    });

    this.index = {
      documents: new Map(),
      invertedIndex: new Map(),
      embeddings: new Map(),
    };
  }

  // ============================================
  // DOCUMENT MANAGEMENT
  // ============================================

  addDocument(content: string, path: string, type?: DocumentType): Document {
    const doc = this.loader.loadFromString(content, path, type);
    this.documents.set(doc.id, doc);
    this.indexDocument(doc);
    return doc;
  }

  addMarkdown(content: string, path: string): Document {
    const doc = this.loader.loadMarkdown(content, path);
    this.documents.set(doc.id, doc);
    this.indexDocument(doc);
    return doc;
  }

  addCode(content: string, path: string, language?: string): Document {
    const doc = this.loader.loadCode(content, path, language);
    this.documents.set(doc.id, doc);
    this.indexDocument(doc);
    return doc;
  }

  removeDocument(id: string): boolean {
    const doc = this.documents.get(id);
    if (!doc) return false;

    this.documents.delete(id);
    this.removeFromIndex(doc);
    return true;
  }

  getDocument(id: string): Document | undefined {
    return this.documents.get(id);
  }

  getDocumentByPath(path: string): Document | undefined {
    for (const doc of this.documents.values()) {
      if (doc.path === path) return doc;
    }
    return undefined;
  }

  getAllDocuments(): Document[] {
    return Array.from(this.documents.values());
  }

  // ============================================
  // CORPUS MANAGEMENT
  // ============================================

  createCorpus(name: string, description?: string): Corpus {
    const corpus: Corpus = {
      id: `corpus_${Date.now()}`,
      name,
      description,
      documents: [],
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        documentCount: 0,
        totalSize: 0,
      },
    };

    this.corpora.set(corpus.id, corpus);
    return corpus;
  }

  addToCorpus(corpusId: string, documentId: string): boolean {
    const corpus = this.corpora.get(corpusId);
    const doc = this.documents.get(documentId);

    if (!corpus || !doc) return false;

    corpus.documents.push(doc);
    corpus.metadata.documentCount++;
    corpus.metadata.totalSize += doc.content.length;
    corpus.metadata.updatedAt = Date.now();

    return true;
  }

  getCorpus(id: string): Corpus | undefined {
    return this.corpora.get(id);
  }

  // ============================================
  // INDEXING
  // ============================================

  private indexDocument(doc: Document): void {
    this.index.documents.set(doc.id, doc);

    // Build inverted index from content
    const tokens = this.tokenize(doc.content);
    for (const token of tokens) {
      if (!this.index.invertedIndex.has(token)) {
        this.index.invertedIndex.set(token, new Set());
      }
      this.index.invertedIndex.get(token)!.add(doc.id);
    }

    // Index chunks
    if (doc.chunks) {
      for (const chunk of doc.chunks) {
        chunk.documentId = doc.id;
        const chunkTokens = this.tokenize(chunk.content);
        for (const token of chunkTokens) {
          if (!this.index.invertedIndex.has(token)) {
            this.index.invertedIndex.set(token, new Set());
          }
          this.index.invertedIndex.get(token)!.add(doc.id);
        }
      }
    }
  }

  private removeFromIndex(doc: Document): void {
    this.index.documents.delete(doc.id);

    // Remove from inverted index
    const tokens = this.tokenize(doc.content);
    for (const token of tokens) {
      const docSet = this.index.invertedIndex.get(token);
      if (docSet) {
        docSet.delete(doc.id);
        if (docSet.size === 0) {
          this.index.invertedIndex.delete(token);
        }
      }
    }
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2);
  }

  // ============================================
  // RAG QUERY
  // ============================================

  query(query: RAGQuery): RAGResult {
    const startTime = Date.now();
    const { topK = 5, threshold = 0.1, filter, includeContent = true } = query;

    // Get candidate documents
    const candidates = this.searchDocuments(query.query, filter);

    // Score and rank
    const scored = candidates.map(doc => ({
      document: doc,
      score: this.scoreDocument(doc, query.query),
      matchedChunks: this.findMatchingChunks(doc, query.query),
    }));

    // Filter by threshold and sort
    const filtered = scored
      .filter(s => s.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // Build context
    const context = this.buildContext(filtered, includeContent);

    return {
      documents: filtered,
      context,
      totalMatches: candidates.length,
      queryTime: Date.now() - startTime,
    };
  }

  private searchDocuments(query: string, filter?: QueryFilter): Document[] {
    const queryTokens = this.tokenize(query);
    const matchingDocIds = new Set<string>();

    // Find documents containing query tokens
    for (const token of queryTokens) {
      const docIds = this.index.invertedIndex.get(token);
      if (docIds) {
        for (const id of docIds) {
          matchingDocIds.add(id);
        }
      }
    }

    // Get documents and apply filters
    let documents = Array.from(matchingDocIds)
      .map(id => this.documents.get(id)!)
      .filter(Boolean);

    if (filter) {
      documents = this.applyFilter(documents, filter);
    }

    return documents;
  }

  private applyFilter(documents: Document[], filter: QueryFilter): Document[] {
    return documents.filter(doc => {
      if (filter.types?.length && !filter.types.includes(doc.type)) {
        return false;
      }

      if (filter.tags?.length) {
        const docTags = doc.metadata.tags || [];
        if (!filter.tags.some(t => docTags.includes(t))) {
          return false;
        }
      }

      if (filter.paths?.length) {
        if (!filter.paths.some(p => doc.path.includes(p))) {
          return false;
        }
      }

      if (filter.providers?.length) {
        if (!filter.providers.includes(doc.metadata.provider || '')) {
          return false;
        }
      }

      if (filter.scope) {
        const docScope = (doc.metadata as any).scope as string | undefined;
        if (filter.scope && docScope !== filter.scope) {
          return false;
        }
      }

      if (filter.dateRange) {
        const modified = doc.metadata.lastModified || 0;
        if (filter.dateRange.start && modified < filter.dateRange.start) {
          return false;
        }
        if (filter.dateRange.end && modified > filter.dateRange.end) {
          return false;
        }
      }

      return true;
    });
  }

  private scoreDocument(doc: Document, query: string): number {
    const queryTokens = this.tokenize(query);
    const docTokens = this.tokenize(doc.content);
    const docTokenSet = new Set(docTokens);

    // TF-IDF-like scoring
    let score = 0;
    const totalDocs = this.documents.size || 1;

    for (const token of queryTokens) {
      if (docTokenSet.has(token)) {
        // Term frequency in document
        const tf = docTokens.filter(t => t === token).length / docTokens.length;
        
        // Inverse document frequency
        const docsWithToken = this.index.invertedIndex.get(token)?.size || 1;
        const idf = Math.log(totalDocs / docsWithToken);
        
        score += tf * idf;
      }
    }

    // Boost for title matches
    if (doc.metadata.title) {
      const titleTokens = this.tokenize(doc.metadata.title);
      const titleMatches = queryTokens.filter(t => titleTokens.includes(t)).length;
      score += titleMatches * 0.5;
    }

    // Normalize
    return Math.min(1, score / queryTokens.length);
  }

  private findMatchingChunks(doc: Document, query: string): DocumentChunk[] {
    if (!doc.chunks?.length) return [];

    const queryTokens = new Set(this.tokenize(query));
    
    return doc.chunks
      .map(chunk => ({
        chunk,
        score: this.tokenize(chunk.content).filter(t => queryTokens.has(t)).length,
      }))
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(c => c.chunk);
  }

  private buildContext(results: ScoredDocument[], includeContent: boolean): string {
    if (!includeContent) {
      return results
        .map(r => `[${r.document.path}] ${r.document.metadata.title || 'Untitled'}`)
        .join('\n');
    }

    const contextParts: string[] = [];

    for (const result of results) {
      const { document, matchedChunks } = result;
      
      contextParts.push(`--- ${document.path} ---`);
      
      if (matchedChunks?.length) {
        // Use matched chunks
        for (const chunk of matchedChunks) {
          contextParts.push(chunk.content);
        }
      } else {
        // Use beginning of document
        const preview = document.content.slice(0, 1000);
        contextParts.push(preview + (document.content.length > 1000 ? '...' : ''));
      }
      
      contextParts.push('');
    }

    return contextParts.join('\n');
  }

  // ============================================
  // SEMANTIC SEARCH (placeholder for embeddings)
  // ============================================

  async setEmbedding(documentId: string, embedding: number[]): Promise<void> {
    this.index.embeddings.set(documentId, embedding);
  }

  async semanticSearch(queryEmbedding: number[], topK = 5): Promise<ScoredDocument[]> {
    const results: Array<{ id: string; score: number }> = [];

    for (const [docId, embedding] of this.index.embeddings) {
      const score = this.cosineSimilarity(queryEmbedding, embedding);
      results.push({ id: docId, score });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(r => ({
        document: this.documents.get(r.id)!,
        score: r.score,
      }))
      .filter(r => r.document);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  // ============================================
  // PERSISTENCE
  // ============================================

  toJSON(): string {
    return JSON.stringify({
      documents: Array.from(this.documents.entries()),
      corpora: Array.from(this.corpora.entries()),
    });
  }

  fromJSON(json: string): void {
    const data = JSON.parse(json);
    
    this.documents.clear();
    this.corpora.clear();
    this.index = {
      documents: new Map(),
      invertedIndex: new Map(),
      embeddings: new Map(),
    };

    for (const [id, doc] of data.documents) {
      this.documents.set(id, doc);
      this.indexDocument(doc);
    }

    for (const [id, corpus] of data.corpora) {
      this.corpora.set(id, corpus);
    }
  }

  /**
   * Export embeddings and auxiliary index data to disk (JSON).
   * This saves `embeddings` and `invertedIndex` for faster reloads.
   */
  exportIndex(filePath: string): void {
    const payload = {
      embeddings: Array.from(this.index.embeddings.entries()),
      invertedIndex: Array.from(this.index.invertedIndex.entries()).map(([k, s]) => [k, Array.from(s)]),
    };

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  /**
   * Import embeddings and index from disk. Does not modify documents/corpora.
   */
  importIndex(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Index file not found: ${filePath}`);
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    if (data.embeddings && Array.isArray(data.embeddings)) {
      this.index.embeddings = new Map(data.embeddings as Array<[string, number[]]>);
    }

    if (data.invertedIndex && Array.isArray(data.invertedIndex)) {
      const map = new Map<string, Set<string>>();
      for (const [token, arr] of data.invertedIndex as Array<[string, string[]]>) {
        map.set(token, new Set(arr));
      }
      this.index.invertedIndex = map;
    }
  }

  // ============================================
  // STATISTICS
  // ============================================

  getStats(): {
    documentCount: number;
    corpusCount: number;
    totalSize: number;
    indexedTokens: number;
  } {
    let totalSize = 0;
    for (const doc of this.documents.values()) {
      totalSize += doc.content.length;
    }

    return {
      documentCount: this.documents.size,
      corpusCount: this.corpora.size,
      totalSize,
      indexedTokens: this.index.invertedIndex.size,
    };
  }
}
