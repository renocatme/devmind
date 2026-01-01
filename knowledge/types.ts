/**
 * Knowledge Base Types
 */

// ============================================
// DOCUMENT TYPES
// ============================================

export type DocumentType = 'markdown' | 'code' | 'json' | 'text' | 'corpus';

export interface Document {
  id: string;
  type: DocumentType;
  path: string;
  content: string;
  metadata: DocumentMetadata;
  chunks?: DocumentChunk[];
  embedding?: number[];
}

export interface DocumentMetadata {
  title?: string;
  description?: string;
  language?: string;
  tags?: string[];
  provider?: string;
  scope?: 'platform' | 'project';
  source?: string;
  lastModified?: number;
  size?: number;
  hash?: string;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  startIndex: number;
  endIndex: number;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

// ============================================
// CORPUS TYPES
// ============================================

export interface Corpus {
  id: string;
  name: string;
  description?: string;
  documents: Document[];
  metadata: CorpusMetadata;
}

export interface CorpusMetadata {
  createdAt: number;
  updatedAt: number;
  documentCount: number;
  totalSize: number;
  tags?: string[];
}

// ============================================
// QUERY TYPES
// ============================================

export interface RAGQuery {
  query: string;
  topK?: number;
  threshold?: number;
  filter?: QueryFilter;
  includeContent?: boolean;
  includeMetadata?: boolean;
}

export interface QueryFilter {
  types?: DocumentType[];
  tags?: string[];
  paths?: string[];
  providers?: string[];
  scope?: 'platform' | 'project';
  dateRange?: {
    start?: number;
    end?: number;
  };
}

export interface RAGResult {
  documents: ScoredDocument[];
  context: string;
  totalMatches: number;
  queryTime: number;
}

export interface ScoredDocument {
  document: Document;
  score: number;
  matchedChunks?: DocumentChunk[];
}

// ============================================
// INDEX TYPES
// ============================================

export interface SearchIndex {
  documents: Map<string, Document>;
  invertedIndex: Map<string, Set<string>>;
  embeddings: Map<string, number[]>;
}

// ============================================
// PROVIDER KNOWLEDGE
// ============================================

export interface ProviderKnowledge {
  provider: string;
  apiDocs: Document[];
  bestPractices: Document[];
  examples: Document[];
  changelog?: Document[];
}

// ============================================
// KNOWLEDGE BASE CONFIG
// ============================================

export interface KnowledgeBaseConfig {
  maxDocuments?: number;
  maxChunkSize?: number;
  chunkOverlap?: number;
  embeddingModel?: string;
  persistPath?: string;
}
