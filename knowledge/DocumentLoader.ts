/**
 * Document Loader - Parse and load documents into the knowledge base
 */

import {
  Document,
  DocumentType,
  DocumentMetadata,
  DocumentChunk,
} from './types';

// ============================================
// DOCUMENT LOADER
// ============================================

export class DocumentLoader {
  private chunkSize: number;
  private chunkOverlap: number;

  constructor(options: { chunkSize?: number; chunkOverlap?: number } = {}) {
    this.chunkSize = options.chunkSize || 1000;
    this.chunkOverlap = options.chunkOverlap || 200;
  }

  // ============================================
  // LOAD METHODS
  // ============================================

  loadFromString(
    content: string,
    path: string,
    type?: DocumentType
  ): Document {
    const detectedType = type || this.detectType(path);
    const metadata = this.extractMetadata(content, detectedType, path);
    const chunks = this.chunkDocument(content, detectedType);

    return {
      id: this.generateId(path),
      type: detectedType,
      path,
      content,
      metadata,
      chunks,
    };
  }

  loadMarkdown(content: string, path: string): Document {
    const metadata = this.extractMarkdownMetadata(content);
    const cleanContent = this.removeMarkdownFrontmatter(content);
    const chunks = this.chunkMarkdown(cleanContent);

    return {
      id: this.generateId(path),
      type: 'markdown',
      path,
      content: cleanContent,
      metadata,
      chunks,
    };
  }

  loadCode(content: string, path: string, language?: string): Document {
    const detectedLanguage = language || this.detectLanguage(path);
    const metadata = this.extractCodeMetadata(content, detectedLanguage);
    const chunks = this.chunkCode(content, detectedLanguage);

    return {
      id: this.generateId(path),
      type: 'code',
      path,
      content,
      metadata: {
        ...metadata,
        language: detectedLanguage,
      },
      chunks,
    };
  }

  loadJSON(content: string, path: string): Document {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }

    const metadata: DocumentMetadata = {
      title: path.split('/').pop(),
      size: content.length,
    };

    // Extract title from common JSON structures
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (obj.name) metadata.title = String(obj.name);
      if (obj.title) metadata.title = String(obj.title);
      if (obj.description) metadata.description = String(obj.description);
    }

    return {
      id: this.generateId(path),
      type: 'json',
      path,
      content,
      metadata,
      chunks: this.chunkJSON(content),
    };
  }

  // ============================================
  // TYPE DETECTION
  // ============================================

  private detectType(path: string): DocumentType {
    const ext = path.split('.').pop()?.toLowerCase();

    switch (ext) {
      case 'md':
      case 'mdx':
        return 'markdown';
      case 'json':
        return 'json';
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
      case 'py':
      case 'java':
      case 'go':
      case 'rs':
      case 'c':
      case 'cpp':
      case 'h':
      case 'hpp':
      case 'cs':
      case 'rb':
      case 'php':
      case 'swift':
      case 'kt':
        return 'code';
      default:
        return 'text';
    }
  }

  private detectLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();

    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      java: 'java',
      go: 'go',
      rs: 'rust',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      rb: 'ruby',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
    };

    return languageMap[ext || ''] || 'text';
  }

  // ============================================
  // METADATA EXTRACTION
  // ============================================

  private extractMetadata(
    content: string,
    type: DocumentType,
    path: string
  ): DocumentMetadata {
    const base: DocumentMetadata = {
      title: path.split('/').pop(),
      size: content.length,
      lastModified: Date.now(),
    };

    switch (type) {
      case 'markdown':
        return { ...base, ...this.extractMarkdownMetadata(content) };
      case 'code':
        return { ...base, ...this.extractCodeMetadata(content, this.detectLanguage(path)) };
      default:
        return base;
    }
  }

  private extractMarkdownMetadata(content: string): DocumentMetadata {
    const metadata: DocumentMetadata = {};

    // Extract YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      
      // Parse simple YAML
      const lines = frontmatter.split('\n');
      for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length) {
          const value = valueParts.join(':').trim();
          switch (key.trim()) {
            case 'title':
              metadata.title = value.replace(/^["']|["']$/g, '');
              break;
            case 'description':
              metadata.description = value.replace(/^["']|["']$/g, '');
              break;
            case 'tags':
              metadata.tags = value.replace(/[\[\]]/g, '').split(',').map(t => t.trim());
              break;
          }
        }
      }
    }

    // Extract first heading as title if not in frontmatter
    if (!metadata.title) {
      const headingMatch = content.match(/^#\s+(.+)$/m);
      if (headingMatch) {
        metadata.title = headingMatch[1];
      }
    }

    return metadata;
  }

  private extractCodeMetadata(content: string, language: string): DocumentMetadata {
    const metadata: DocumentMetadata = {
      language,
    };

    // Extract JSDoc/docstring
    if (['typescript', 'javascript'].includes(language)) {
      const jsdocMatch = content.match(/\/\*\*\s*\n([^*]|\*[^/])*\*\//);
      if (jsdocMatch) {
        const descMatch = jsdocMatch[0].match(/@description\s+(.+)/);
        if (descMatch) {
          metadata.description = descMatch[1];
        }
      }
    }

    if (language === 'python') {
      const docstringMatch = content.match(/^"""([\s\S]*?)"""/m);
      if (docstringMatch) {
        metadata.description = docstringMatch[1].trim().split('\n')[0];
      }
    }

    return metadata;
  }

  // ============================================
  // CHUNKING
  // ============================================

  private chunkDocument(content: string, type: DocumentType): DocumentChunk[] {
    switch (type) {
      case 'markdown':
        return this.chunkMarkdown(content);
      case 'code':
        return this.chunkCode(content, 'text');
      case 'json':
        return this.chunkJSON(content);
      default:
        return this.chunkText(content);
    }
  }

  private chunkText(content: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    let startIndex = 0;

    while (startIndex < content.length) {
      const endIndex = Math.min(startIndex + this.chunkSize, content.length);
      
      // Try to break at sentence or paragraph boundary
      let actualEnd = endIndex;
      if (endIndex < content.length) {
        const breakPoints = ['\n\n', '\n', '. ', '! ', '? '];
        for (const bp of breakPoints) {
          const lastBreak = content.lastIndexOf(bp, endIndex);
          if (lastBreak > startIndex + this.chunkSize / 2) {
            actualEnd = lastBreak + bp.length;
            break;
          }
        }
      }

      chunks.push({
        id: `chunk_${chunks.length}`,
        documentId: '',
        content: content.slice(startIndex, actualEnd),
        startIndex,
        endIndex: actualEnd,
      });

      startIndex = actualEnd - this.chunkOverlap;
      if (startIndex >= content.length - this.chunkOverlap) break;
    }

    return chunks;
  }

  private chunkMarkdown(content: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    
    // Split by headers
    const sections = content.split(/(?=^#{1,6}\s)/m);
    
    for (const section of sections) {
      if (!section.trim()) continue;

      if (section.length <= this.chunkSize) {
        const startIndex = content.indexOf(section);
        chunks.push({
          id: `chunk_${chunks.length}`,
          documentId: '',
          content: section,
          startIndex,
          endIndex: startIndex + section.length,
          metadata: {
            heading: section.match(/^#{1,6}\s+(.+)$/m)?.[1],
          },
        });
      } else {
        // Further chunk large sections
        const subChunks = this.chunkText(section);
        chunks.push(...subChunks);
      }
    }

    return chunks;
  }

  private chunkCode(content: string, language: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    
    // Try to split by functions/classes
    const patterns: Record<string, RegExp> = {
      typescript: /(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type)\s+\w+/g,
      javascript: /(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+\w+/g,
      python: /(?:def|class|async def)\s+\w+/g,
    };

    const pattern = patterns[language];
    if (pattern) {
      const matches = [...content.matchAll(pattern)];
      let lastEnd = 0;

      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const nextMatch = matches[i + 1];
        const startIndex = match.index!;
        const endIndex = nextMatch?.index || content.length;

        if (startIndex > lastEnd) {
          // Add content before this match
          const preContent = content.slice(lastEnd, startIndex);
          if (preContent.trim()) {
            chunks.push({
              id: `chunk_${chunks.length}`,
              documentId: '',
              content: preContent,
              startIndex: lastEnd,
              endIndex: startIndex,
            });
          }
        }

        const chunkContent = content.slice(startIndex, endIndex);
        if (chunkContent.length <= this.chunkSize) {
          chunks.push({
            id: `chunk_${chunks.length}`,
            documentId: '',
            content: chunkContent,
            startIndex,
            endIndex,
            metadata: { symbol: match[0] },
          });
        } else {
          // Further chunk large blocks
          const subChunks = this.chunkText(chunkContent);
          chunks.push(...subChunks.map(c => ({
            ...c,
            startIndex: startIndex + c.startIndex,
            endIndex: startIndex + c.endIndex,
          })));
        }

        lastEnd = endIndex;
      }

      // Add remaining content
      if (lastEnd < content.length) {
        const remaining = content.slice(lastEnd);
        if (remaining.trim()) {
          chunks.push({
            id: `chunk_${chunks.length}`,
            documentId: '',
            content: remaining,
            startIndex: lastEnd,
            endIndex: content.length,
          });
        }
      }
    } else {
      // Fallback to text chunking
      return this.chunkText(content);
    }

    return chunks.length > 0 ? chunks : this.chunkText(content);
  }

  private chunkJSON(content: string): DocumentChunk[] {
    // For JSON, we typically want to keep it as one chunk if small
    if (content.length <= this.chunkSize) {
      return [{
        id: 'chunk_0',
        documentId: '',
        content,
        startIndex: 0,
        endIndex: content.length,
      }];
    }

    // For large JSON, try to split by top-level keys
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        const chunks: DocumentChunk[] = [];
        for (const [key, value] of Object.entries(parsed)) {
          const chunkContent = JSON.stringify({ [key]: value }, null, 2);
          chunks.push({
            id: `chunk_${chunks.length}`,
            documentId: '',
            content: chunkContent,
            startIndex: 0,
            endIndex: chunkContent.length,
            metadata: { key },
          });
        }
        return chunks;
      }
    } catch {
      // Invalid JSON, fall back to text chunking
    }

    return this.chunkText(content);
  }

  // ============================================
  // UTILITIES
  // ============================================

  private removeMarkdownFrontmatter(content: string): string {
    return content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  }

  private generateId(path: string): string {
    const hash = this.simpleHash(path + Date.now());
    return `doc_${hash}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}
