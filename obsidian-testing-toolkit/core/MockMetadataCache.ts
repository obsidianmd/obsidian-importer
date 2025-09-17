/**
 * Obsidian Testing Toolkit - Mock Metadata Cache Implementation
 *
 * Mock implementation of Obsidian's MetadataCache for testing file metadata,
 * links, tags, and frontmatter processing.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { MockVault, MockTFile } from './MockVault';

/**
 * Frontmatter interface
 */
export interface FrontmatterCache {
  [key: string]: any;
  position?: {
    start: { line: number; col: number; offset: number };
    end: { line: number; col: number; offset: number };
  };
}

/**
 * Link interface
 */
export interface LinkCache {
  link: string;
  original: string;
  displayText?: string;
  position: {
    start: { line: number; col: number; offset: number };
    end: { line: number; col: number; offset: number };
  };
}

/**
 * Embed interface
 */
export interface EmbedCache {
  link: string;
  original: string;
  displayText?: string;
  position: {
    start: { line: number; col: number; offset: number };
    end: { line: number; col: number; offset: number };
  };
}

/**
 * Tag interface
 */
export interface TagCache {
  tag: string;
  position: {
    start: { line: number; col: number; offset: number };
    end: { line: number; col: number; offset: number };
  };
}

/**
 * Heading interface
 */
export interface HeadingCache {
  heading: string;
  level: number;
  position: {
    start: { line: number; col: number; offset: number };
    end: { line: number; col: number; offset: number };
  };
}

/**
 * Block interface
 */
export interface BlockCache {
  id: string;
  position: {
    start: { line: number; col: number; offset: number };
    end: { line: number; col: number; offset: number };
  };
}

/**
 * Section interface
 */
export interface SectionCache {
  type: 'paragraph' | 'heading' | 'list' | 'code' | 'quote' | 'callout' | 'table';
  position: {
    start: { line: number; col: number; offset: number };
    end: { line: number; col: number; offset: number };
  };
}

/**
 * File cache interface
 */
export interface CachedMetadata {
  frontmatter?: FrontmatterCache;
  links?: LinkCache[];
  embeds?: EmbedCache[];
  tags?: TagCache[];
  headings?: HeadingCache[];
  blocks?: BlockCache[];
  sections?: SectionCache[];
  listItems?: any[];
}

/**
 * Configuration options for MockMetadataCache
 */
export interface MockMetadataCacheConfig {
  vault: MockVault;
  autoUpdate?: boolean;
  parseDelay?: number;
}

/**
 * Mock implementation of Obsidian's MetadataCache
 */
export class MockMetadataCache extends EventEmitter {
  public app: any;
  public vault: MockVault;

  private cache: Map<string, CachedMetadata> = new Map();
  private resolvedLinks: Map<string, Record<string, number>> = new Map();
  private unresolvedLinks: Map<string, Record<string, number>> = new Map();
  private config: MockMetadataCacheConfig;
  private updateTimeout: any = null;

  constructor(config: MockMetadataCacheConfig) {
    super();
    this.config = config;
    this.vault = config.vault;

    // Listen to vault changes
    this.vault.on('create', (file) => this.onFileCreated(file));
    this.vault.on('modify', (file) => this.onFileModified(file));
    this.vault.on('delete', (file) => this.onFileDeleted(file));
    this.vault.on('rename', (file, oldPath) => this.onFileRenamed(file, oldPath));
  }

  /**
   * Get cached metadata for a file
   */
  public getFileCache(file: MockTFile): CachedMetadata | null {
    return this.cache.get(file.path) || null;
  }

  /**
   * Get frontmatter for a file
   */
  public getFileCache(file: MockTFile): CachedMetadata | null;
  public getFileCache(file: MockTFile, getCached?: boolean): CachedMetadata | null {
    const cached = this.cache.get(file.path);
    if (cached || getCached !== false) {
      return cached || null;
    }

    // Force update if not cached and getCached is false
    this.updateFileCache(file);
    return this.cache.get(file.path) || null;
  }

  /**
   * Get all cached files
   */
  public getCachedFiles(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Check if file is cached
   */
  public isCached(file: MockTFile): boolean {
    return this.cache.has(file.path);
  }

  /**
   * Get resolved links for a file
   */
  public getResolvedLinks(file: MockTFile): Record<string, number> {
    return this.resolvedLinks.get(file.path) || {};
  }

  /**
   * Get unresolved links for a file
   */
  public getUnresolvedLinks(file: MockTFile): Record<string, number> {
    return this.unresolvedLinks.get(file.path) || {};
  }

  /**
   * Get all tags in the vault
   */
  public getTags(): Record<string, number> {
    const tags: Record<string, number> = {};

    for (const metadata of this.cache.values()) {
      if (metadata.tags) {
        for (const tag of metadata.tags) {
          tags[tag.tag] = (tags[tag.tag] || 0) + 1;
        }
      }
    }

    return tags;
  }

  /**
   * Get backlinks for a file
   */
  public getBacklinksForFile(file: MockTFile): Record<string, LinkCache[]> {
    const backlinks: Record<string, LinkCache[]> = {};
    const targetPath = file.path;
    const targetBasename = file.basename;

    for (const [sourcePath, metadata] of this.cache) {
      if (sourcePath === targetPath) continue;

      const linksToTarget: LinkCache[] = [];

      if (metadata.links) {
        for (const link of metadata.links) {
          if (link.link === targetPath || link.link === targetBasename) {
            linksToTarget.push(link);
          }
        }
      }

      if (linksToTarget.length > 0) {
        backlinks[sourcePath] = linksToTarget;
      }
    }

    return backlinks;
  }

  /**
   * Trigger cache update for a file
   */
  public async triggerCacheUpdate(file: MockTFile): Promise<void> {
    await this.updateFileCache(file);
  }

  /**
   * Clear cache for a file
   */
  public clearCache(file: MockTFile): void {
    this.cache.delete(file.path);
    this.resolvedLinks.delete(file.path);
    this.unresolvedLinks.delete(file.path);
    this.emit('cache-cleared', file);
  }

  /**
   * Clear all cache
   */
  public clear(): void {
    this.cache.clear();
    this.resolvedLinks.clear();
    this.unresolvedLinks.clear();
    this.emit('cache-cleared-all');
  }

  /**
   * Force update of all file caches
   */
  public async updateAllCaches(): Promise<void> {
    const files = this.vault.getMarkdownFiles();
    for (const file of files) {
      await this.updateFileCache(file);
    }
  }

  /**
   * Update cache for a specific file
   */
  private async updateFileCache(file: MockTFile): Promise<void> {
    try {
      const content = await this.vault.read(file);
      const metadata = await this.parseFileContent(content, file);

      this.cache.set(file.path, metadata);
      this.updateLinkCache(file, metadata);

      this.emit('cache-update', file, metadata);
    } catch (error) {
      console.error(`Failed to update cache for ${file.path}:`, error);
    }
  }

  /**
   * Parse file content to extract metadata
   */
  private async parseFileContent(content: string, file: MockTFile): Promise<CachedMetadata> {
    const metadata: CachedMetadata = {};
    const lines = content.split('\n');

    // Parse frontmatter
    metadata.frontmatter = this.parseFrontmatter(content);

    // Parse links and embeds
    const { links, embeds } = this.parseLinksAndEmbeds(content);
    metadata.links = links;
    metadata.embeds = embeds;

    // Parse tags
    metadata.tags = this.parseTags(content);

    // Parse headings
    metadata.headings = this.parseHeadings(content);

    // Parse blocks
    metadata.blocks = this.parseBlocks(content);

    // Parse sections
    metadata.sections = this.parseSections(content);

    return metadata;
  }

  /**
   * Parse frontmatter from content
   */
  private parseFrontmatter(content: string): FrontmatterCache | undefined {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
    const match = content.match(frontmatterRegex);

    if (!match) return undefined;

    const frontmatterText = match[1];
    const frontmatter: FrontmatterCache = {};

    // Simple YAML parsing (basic key: value pairs)
    const lines = frontmatterText.split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();

        // Parse value
        if (value.startsWith('[') && value.endsWith(']')) {
          // Array
          frontmatter[key] = value.slice(1, -1).split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
        } else if (value === 'true' || value === 'false') {
          // Boolean
          frontmatter[key] = value === 'true';
        } else if (!isNaN(Number(value))) {
          // Number
          frontmatter[key] = Number(value);
        } else {
          // String
          frontmatter[key] = value.replace(/^["']|["']$/g, '');
        }
      }
    }

    frontmatter.position = {
      start: { line: 0, col: 0, offset: 0 },
      end: { line: match[0].split('\n').length - 1, col: 0, offset: match[0].length }
    };

    return frontmatter;
  }

  /**
   * Parse links and embeds from content
   */
  private parseLinksAndEmbeds(content: string): { links: LinkCache[]; embeds: EmbedCache[] } {
    const links: LinkCache[] = [];
    const embeds: EmbedCache[] = [];

    // Wiki-style links: [[link]] or [[link|display]]
    const wikiLinkRegex = /(!?)\[\[([^|\]]+)(\|([^\]]+))?\]\]/g;
    let match;

    while ((match = wikiLinkRegex.exec(content)) !== null) {
      const isEmbed = match[1] === '!';
      const link = match[2];
      const displayText = match[4];
      const original = match[0];

      const position = this.getPositionFromOffset(content, match.index);

      const linkData = {
        link,
        original,
        displayText,
        position: {
          start: position,
          end: this.getPositionFromOffset(content, match.index + match[0].length)
        }
      };

      if (isEmbed) {
        embeds.push(linkData);
      } else {
        links.push(linkData);
      }
    }

    // Markdown links: [text](link)
    const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((match = markdownLinkRegex.exec(content)) !== null) {
      const displayText = match[1];
      const link = match[2];
      const original = match[0];

      // Skip external links
      if (link.startsWith('http') || link.startsWith('mailto:')) {
        continue;
      }

      const position = this.getPositionFromOffset(content, match.index);

      links.push({
        link,
        original,
        displayText,
        position: {
          start: position,
          end: this.getPositionFromOffset(content, match.index + match[0].length)
        }
      });
    }

    return { links, embeds };
  }

  /**
   * Parse tags from content
   */
  private parseTags(content: string): TagCache[] {
    const tags: TagCache[] = [];
    const tagRegex = /#[\w-]+/g;
    let match;

    while ((match = tagRegex.exec(content)) !== null) {
      const position = this.getPositionFromOffset(content, match.index);

      tags.push({
        tag: match[0],
        position: {
          start: position,
          end: this.getPositionFromOffset(content, match.index + match[0].length)
        }
      });
    }

    return tags;
  }

  /**
   * Parse headings from content
   */
  private parseHeadings(content: string): HeadingCache[] {
    const headings: HeadingCache[] = [];
    const lines = content.split('\n');
    let offset = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headingMatch) {
        const level = headingMatch[1].length;
        const heading = headingMatch[2];

        headings.push({
          heading,
          level,
          position: {
            start: { line: i, col: 0, offset },
            end: { line: i, col: line.length, offset: offset + line.length }
          }
        });
      }

      offset += line.length + 1; // +1 for newline
    }

    return headings;
  }

  /**
   * Parse blocks from content
   */
  private parseBlocks(content: string): BlockCache[] {
    const blocks: BlockCache[] = [];
    const blockRegex = /\^([a-zA-Z0-9-]+)$/gm;
    let match;

    while ((match = blockRegex.exec(content)) !== null) {
      const id = match[1];
      const position = this.getPositionFromOffset(content, match.index);

      blocks.push({
        id,
        position: {
          start: position,
          end: this.getPositionFromOffset(content, match.index + match[0].length)
        }
      });
    }

    return blocks;
  }

  /**
   * Parse sections from content
   */
  private parseSections(content: string): SectionCache[] {
    const sections: SectionCache[] = [];
    const lines = content.split('\n');
    let offset = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let type: SectionCache['type'] = 'paragraph';

      if (line.match(/^#{1,6}\s+/)) {
        type = 'heading';
      } else if (line.match(/^[\s]*[-*+]\s+/) || line.match(/^[\s]*\d+\.\s+/)) {
        type = 'list';
      } else if (line.match(/^```/)) {
        type = 'code';
      } else if (line.match(/^>\s+/)) {
        type = 'quote';
      } else if (line.match(/^\|.*\|$/)) {
        type = 'table';
      }

      if (line.trim() !== '') {
        sections.push({
          type,
          position: {
            start: { line: i, col: 0, offset },
            end: { line: i, col: line.length, offset: offset + line.length }
          }
        });
      }

      offset += line.length + 1; // +1 for newline
    }

    return sections;
  }

  /**
   * Update link cache after parsing
   */
  private updateLinkCache(file: MockTFile, metadata: CachedMetadata): void {
    const resolved: Record<string, number> = {};
    const unresolved: Record<string, number> = {};

    if (metadata.links) {
      for (const link of metadata.links) {
        const targetFile = this.vault.getFileByPath(link.link) ||
                          this.vault.getFiles().find(f => f.basename === link.link);

        if (targetFile) {
          resolved[targetFile.path] = (resolved[targetFile.path] || 0) + 1;
        } else {
          unresolved[link.link] = (unresolved[link.link] || 0) + 1;
        }
      }
    }

    this.resolvedLinks.set(file.path, resolved);
    this.unresolvedLinks.set(file.path, unresolved);
  }

  /**
   * Convert offset to line/column position
   */
  private getPositionFromOffset(content: string, offset: number): { line: number; col: number; offset: number } {
    const lines = content.substring(0, offset).split('\n');
    return {
      line: lines.length - 1,
      col: lines[lines.length - 1].length,
      offset
    };
  }

  /**
   * Event handlers
   */
  private onFileCreated(file: MockTFile): void {
    if (file.extension === 'md') {
      this.scheduleUpdate(file);
    }
  }

  private onFileModified(file: MockTFile): void {
    if (file.extension === 'md') {
      this.scheduleUpdate(file);
    }
  }

  private onFileDeleted(file: MockTFile): void {
    this.clearCache(file);
  }

  private onFileRenamed(file: MockTFile, oldPath: string): void {
    // Remove old cache entry
    const oldMetadata = this.cache.get(oldPath);
    this.cache.delete(oldPath);
    this.resolvedLinks.delete(oldPath);
    this.unresolvedLinks.delete(oldPath);

    // Add new cache entry
    if (oldMetadata) {
      this.cache.set(file.path, oldMetadata);
    }

    // Update all files that reference this file
    this.updateAllCaches();
  }

  /**
   * Schedule cache update with debouncing
   */
  private scheduleUpdate(file: MockTFile): void {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }

    this.updateTimeout = setTimeout(() => {
      this.updateFileCache(file);
    }, this.config.parseDelay || 100);
  }

  /**
   * Create snapshot of metadata cache
   */
  public getSnapshot(): any {
    return {
      cache: Array.from(this.cache.entries()),
      resolvedLinks: Array.from(this.resolvedLinks.entries()),
      unresolvedLinks: Array.from(this.unresolvedLinks.entries()),
      timestamp: Date.now()
    };
  }

  /**
   * Restore metadata cache from snapshot
   */
  public async restoreFromSnapshot(snapshot: any): Promise<void> {
    this.cache.clear();
    this.resolvedLinks.clear();
    this.unresolvedLinks.clear();

    for (const [path, metadata] of snapshot.cache) {
      this.cache.set(path, metadata);
    }

    for (const [path, links] of snapshot.resolvedLinks) {
      this.resolvedLinks.set(path, links);
    }

    for (const [path, links] of snapshot.unresolvedLinks) {
      this.unresolvedLinks.set(path, links);
    }

    this.emit('snapshot-restored', snapshot);
  }
}