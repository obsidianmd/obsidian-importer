/**
 * Obsidian Testing Toolkit - File System Mock
 *
 * Virtual file system implementation for testing. Provides in-memory
 * file operations that simulate real file system behavior.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

import { EventEmitter } from 'events';

/**
 * File system entry interface
 */
export interface FSEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  content?: string | ArrayBuffer;
  children?: Map<string, FSEntry>;
  stat: {
    size: number;
    ctime: number;
    mtime: number;
    isFile(): boolean;
    isDirectory(): boolean;
  };
  parent?: FSEntry;
}

/**
 * File system configuration options
 */
export interface FileSystemMockConfig {
  adapter?: 'memory' | 'filesystem';
  caseSensitive?: boolean;
  maxFileSize?: number;
  simulateLatency?: boolean;
  latencyMs?: number;
}

/**
 * Mock file system implementation
 */
export class FileSystemMock extends EventEmitter {
  private root: FSEntry;
  private config: FileSystemMockConfig;
  private totalSize: number = 0;

  constructor(config: FileSystemMockConfig = {}) {
    super();
    this.config = {
      adapter: 'memory',
      caseSensitive: process.platform !== 'win32',
      maxFileSize: 50 * 1024 * 1024, // 50MB default
      simulateLatency: false,
      latencyMs: 10,
      ...config
    };

    this.root = this.createEntry('', '', 'directory');
  }

  /**
   * Check if a path exists
   */
  public async exists(path: string): Promise<boolean> {
    await this.simulateLatency();
    const normalizedPath = this.normalizePath(path);
    const entry = this.findEntry(normalizedPath);
    return entry !== null;
  }

  /**
   * Get file/directory stats
   */
  public async stat(path: string): Promise<FSEntry['stat'] | null> {
    await this.simulateLatency();
    const normalizedPath = this.normalizePath(path);
    const entry = this.findEntry(normalizedPath);
    return entry ? entry.stat : null;
  }

  /**
   * Read file content as string
   */
  public async readFile(path: string, encoding: string = 'utf8'): Promise<string> {
    await this.simulateLatency();
    const normalizedPath = this.normalizePath(path);
    const entry = this.findEntry(normalizedPath);

    if (!entry) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }

    if (entry.type !== 'file') {
      throw new Error(`EISDIR: illegal operation on a directory, read '${path}'`);
    }

    if (typeof entry.content === 'string') {
      return entry.content;
    } else if (entry.content instanceof ArrayBuffer) {
      const decoder = new TextDecoder(encoding);
      return decoder.decode(entry.content);
    }

    return '';
  }

  /**
   * Read file content as buffer
   */
  public async readFileBuffer(path: string): Promise<ArrayBuffer> {
    await this.simulateLatency();
    const normalizedPath = this.normalizePath(path);
    const entry = this.findEntry(normalizedPath);

    if (!entry) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }

    if (entry.type !== 'file') {
      throw new Error(`EISDIR: illegal operation on a directory, read '${path}'`);
    }

    if (entry.content instanceof ArrayBuffer) {
      return entry.content;
    } else if (typeof entry.content === 'string') {
      const encoder = new TextEncoder();
      return encoder.encode(entry.content).buffer;
    }

    return new ArrayBuffer(0);
  }

  /**
   * Write file content
   */
  public async writeFile(path: string, content: string | ArrayBuffer): Promise<void> {
    await this.simulateLatency();
    const normalizedPath = this.normalizePath(path);

    // Check file size limit
    const size = typeof content === 'string' ? content.length : content.byteLength;
    if (size > this.config.maxFileSize!) {
      throw new Error(`File size ${size} exceeds maximum allowed size ${this.config.maxFileSize}`);
    }

    // Ensure parent directory exists
    const parentPath = this.getParentPath(normalizedPath);
    if (parentPath) {
      await this.ensureDirectoryExists(parentPath);
    }

    let entry = this.findEntry(normalizedPath);

    if (entry) {
      // Update existing file
      if (entry.type !== 'file') {
        throw new Error(`EISDIR: illegal operation on a directory, open '${path}'`);
      }

      const oldSize = this.getEntrySize(entry);
      entry.content = content;
      entry.stat.size = size;
      entry.stat.mtime = Date.now();

      this.totalSize = this.totalSize - oldSize + size;
    } else {
      // Create new file
      const fileName = this.getFileName(normalizedPath);
      const parent = parentPath ? this.findEntry(parentPath) : this.root;

      if (!parent || parent.type !== 'directory') {
        throw new Error(`ENOTDIR: not a directory, open '${parentPath}'`);
      }

      entry = this.createEntry(fileName, normalizedPath, 'file', content);
      parent.children!.set(this.getKey(fileName), entry);
      entry.parent = parent;

      this.totalSize += size;
    }

    this.emit('change', 'write', normalizedPath, entry);
  }

  /**
   * Append content to file
   */
  public async appendFile(path: string, content: string): Promise<void> {
    await this.simulateLatency();
    const normalizedPath = this.normalizePath(path);
    const entry = this.findEntry(normalizedPath);

    if (entry && entry.type === 'file') {
      const existingContent = typeof entry.content === 'string' ? entry.content : '';
      await this.writeFile(path, existingContent + content);
    } else {
      await this.writeFile(path, content);
    }
  }

  /**
   * Create directory
   */
  public async mkdir(path: string, recursive: boolean = false): Promise<void> {
    await this.simulateLatency();
    const normalizedPath = this.normalizePath(path);

    if (this.findEntry(normalizedPath)) {
      throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
    }

    const parentPath = this.getParentPath(normalizedPath);

    if (parentPath && !this.findEntry(parentPath)) {
      if (recursive) {
        await this.mkdir(parentPath, true);
      } else {
        throw new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
      }
    }

    const dirName = this.getFileName(normalizedPath);
    const parent = parentPath ? this.findEntry(parentPath) : this.root;

    if (!parent || parent.type !== 'directory') {
      throw new Error(`ENOTDIR: not a directory, mkdir '${path}'`);
    }

    const entry = this.createEntry(dirName, normalizedPath, 'directory');
    parent.children!.set(this.getKey(dirName), entry);
    entry.parent = parent;

    this.emit('change', 'mkdir', normalizedPath, entry);
  }

  /**
   * Remove file or directory
   */
  public async remove(path: string, recursive: boolean = false): Promise<void> {
    await this.simulateLatency();
    const normalizedPath = this.normalizePath(path);
    const entry = this.findEntry(normalizedPath);

    if (!entry) {
      throw new Error(`ENOENT: no such file or directory, unlink '${path}'`);
    }

    if (entry.type === 'directory' && entry.children!.size > 0 && !recursive) {
      throw new Error(`ENOTEMPTY: directory not empty, rmdir '${path}'`);
    }

    // Remove from parent
    if (entry.parent) {
      const key = this.getKey(entry.name);
      entry.parent.children!.delete(key);
    }

    // Update total size
    this.totalSize -= this.calculateEntrySize(entry);

    this.emit('change', 'remove', normalizedPath, entry);
  }

  /**
   * Rename/move file or directory
   */
  public async rename(oldPath: string, newPath: string): Promise<void> {
    await this.simulateLatency();
    const normalizedOldPath = this.normalizePath(oldPath);
    const normalizedNewPath = this.normalizePath(newPath);

    const entry = this.findEntry(normalizedOldPath);
    if (!entry) {
      throw new Error(`ENOENT: no such file or directory, rename '${oldPath}' -> '${newPath}'`);
    }

    if (this.findEntry(normalizedNewPath)) {
      throw new Error(`EEXIST: file already exists, rename '${oldPath}' -> '${newPath}'`);
    }

    // Ensure new parent directory exists
    const newParentPath = this.getParentPath(normalizedNewPath);
    if (newParentPath) {
      await this.ensureDirectoryExists(newParentPath);
    }

    // Remove from old parent
    if (entry.parent) {
      const oldKey = this.getKey(entry.name);
      entry.parent.children!.delete(oldKey);
    }

    // Update entry properties
    entry.name = this.getFileName(normalizedNewPath);
    entry.path = normalizedNewPath;

    // Add to new parent
    const newParent = newParentPath ? this.findEntry(newParentPath) : this.root;
    if (!newParent || newParent.type !== 'directory') {
      throw new Error(`ENOTDIR: not a directory, rename '${oldPath}' -> '${newPath}'`);
    }

    const newKey = this.getKey(entry.name);
    newParent.children!.set(newKey, entry);
    entry.parent = newParent;

    // Update paths recursively for directories
    if (entry.type === 'directory') {
      this.updatePathsRecursively(entry, normalizedNewPath);
    }

    this.emit('change', 'rename', normalizedNewPath, entry, normalizedOldPath);
  }

  /**
   * Copy file or directory
   */
  public async copy(sourcePath: string, destPath: string): Promise<void> {
    await this.simulateLatency();
    const normalizedSourcePath = this.normalizePath(sourcePath);
    const normalizedDestPath = this.normalizePath(destPath);

    const sourceEntry = this.findEntry(normalizedSourcePath);
    if (!sourceEntry) {
      throw new Error(`ENOENT: no such file or directory, copy '${sourcePath}'`);
    }

    if (this.findEntry(normalizedDestPath)) {
      throw new Error(`EEXIST: file already exists, copy '${sourcePath}' -> '${destPath}'`);
    }

    if (sourceEntry.type === 'file') {
      await this.writeFile(destPath, sourceEntry.content || '');
    } else {
      await this.mkdir(destPath);

      // Copy all children recursively
      for (const [, child] of sourceEntry.children!) {
        const childDestPath = `${destPath}/${child.name}`;
        await this.copy(child.path, childDestPath);
      }
    }

    this.emit('change', 'copy', normalizedDestPath, this.findEntry(normalizedDestPath));
  }

  /**
   * List directory contents
   */
  public async readdir(path: string): Promise<string[]> {
    await this.simulateLatency();
    const normalizedPath = this.normalizePath(path);
    const entry = this.findEntry(normalizedPath);

    if (!entry) {
      throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    }

    if (entry.type !== 'directory') {
      throw new Error(`ENOTDIR: not a directory, scandir '${path}'`);
    }

    return Array.from(entry.children!.keys()).map(key =>
      this.config.caseSensitive ? key : key.toLowerCase()
    );
  }

  /**
   * Get total file system size
   */
  public getTotalSize(): number {
    return this.totalSize;
  }

  /**
   * Get file system stats
   */
  public getStats(): { totalSize: number; fileCount: number; directoryCount: number } {
    const stats = { totalSize: this.totalSize, fileCount: 0, directoryCount: 0 };
    this.collectStatsRecursively(this.root, stats);
    return stats;
  }

  /**
   * Create a snapshot of the file system
   */
  public createSnapshot(): any {
    return {
      root: this.serializeEntry(this.root),
      totalSize: this.totalSize,
      timestamp: Date.now()
    };
  }

  /**
   * Restore file system from snapshot
   */
  public async restoreFromSnapshot(snapshot: any): Promise<void> {
    this.root = this.deserializeEntry(snapshot.root);
    this.totalSize = snapshot.totalSize;
    this.emit('snapshot-restored', snapshot);
  }

  /**
   * Clean up file system
   */
  public async cleanup(): Promise<void> {
    this.root = this.createEntry('', '', 'directory');
    this.totalSize = 0;
    this.emit('cleanup');
  }

  /**
   * Normalize path for consistent handling
   */
  private normalizePath(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '');
    return this.config.caseSensitive ? normalized : normalized.toLowerCase();
  }

  /**
   * Get key for map storage (handles case sensitivity)
   */
  private getKey(name: string): string {
    return this.config.caseSensitive ? name : name.toLowerCase();
  }

  /**
   * Find entry by path
   */
  private findEntry(path: string): FSEntry | null {
    if (!path) return this.root;

    const parts = path.split('/').filter(part => part.length > 0);
    let current = this.root;

    for (const part of parts) {
      if (!current.children) return null;
      const key = this.getKey(part);
      const next = current.children.get(key);
      if (!next) return null;
      current = next;
    }

    return current;
  }

  /**
   * Create new file system entry
   */
  private createEntry(name: string, path: string, type: 'file' | 'directory', content?: string | ArrayBuffer): FSEntry {
    const now = Date.now();
    const size = content ? (typeof content === 'string' ? content.length : content.byteLength) : 0;

    return {
      name,
      path,
      type,
      content,
      children: type === 'directory' ? new Map() : undefined,
      stat: {
        size,
        ctime: now,
        mtime: now,
        isFile: () => type === 'file',
        isDirectory: () => type === 'directory'
      }
    };
  }

  /**
   * Get parent path
   */
  private getParentPath(path: string): string {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/');
  }

  /**
   * Get file name from path
   */
  private getFileName(path: string): string {
    return path.split('/').pop() || '';
  }

  /**
   * Ensure directory exists (create if needed)
   */
  private async ensureDirectoryExists(path: string): Promise<void> {
    if (!this.findEntry(path)) {
      await this.mkdir(path, true);
    }
  }

  /**
   * Calculate entry size recursively
   */
  private calculateEntrySize(entry: FSEntry): number {
    if (entry.type === 'file') {
      return entry.stat.size;
    }

    let size = 0;
    if (entry.children) {
      for (const [, child] of entry.children) {
        size += this.calculateEntrySize(child);
      }
    }
    return size;
  }

  /**
   * Get entry size
   */
  private getEntrySize(entry: FSEntry): number {
    return entry.stat.size;
  }

  /**
   * Update paths recursively for moved directories
   */
  private updatePathsRecursively(entry: FSEntry, newBasePath: string): void {
    if (entry.children) {
      for (const [, child] of entry.children) {
        child.path = `${newBasePath}/${child.name}`;
        if (child.type === 'directory') {
          this.updatePathsRecursively(child, child.path);
        }
      }
    }
  }

  /**
   * Collect stats recursively
   */
  private collectStatsRecursively(entry: FSEntry, stats: any): void {
    if (entry.type === 'file') {
      stats.fileCount++;
    } else {
      stats.directoryCount++;
      if (entry.children) {
        for (const [, child] of entry.children) {
          this.collectStatsRecursively(child, stats);
        }
      }
    }
  }

  /**
   * Serialize entry for snapshot
   */
  private serializeEntry(entry: FSEntry): any {
    const serialized: any = {
      name: entry.name,
      path: entry.path,
      type: entry.type,
      stat: { ...entry.stat }
    };

    if (entry.content !== undefined) {
      if (typeof entry.content === 'string') {
        serialized.content = entry.content;
        serialized.contentType = 'string';
      } else {
        // Convert ArrayBuffer to base64 for serialization
        const uint8Array = new Uint8Array(entry.content);
        serialized.content = btoa(String.fromCharCode.apply(null, Array.from(uint8Array)));
        serialized.contentType = 'buffer';
      }
    }

    if (entry.children) {
      serialized.children = Array.from(entry.children.entries()).map(([key, child]) => [
        key,
        this.serializeEntry(child)
      ]);
    }

    return serialized;
  }

  /**
   * Deserialize entry from snapshot
   */
  private deserializeEntry(serialized: any): FSEntry {
    const entry: FSEntry = {
      name: serialized.name,
      path: serialized.path,
      type: serialized.type,
      stat: {
        ...serialized.stat,
        isFile: () => serialized.type === 'file',
        isDirectory: () => serialized.type === 'directory'
      }
    };

    if (serialized.content !== undefined) {
      if (serialized.contentType === 'string') {
        entry.content = serialized.content;
      } else if (serialized.contentType === 'buffer') {
        // Convert base64 back to ArrayBuffer
        const binaryString = atob(serialized.content);
        const uint8Array = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          uint8Array[i] = binaryString.charCodeAt(i);
        }
        entry.content = uint8Array.buffer;
      }
    }

    if (serialized.children) {
      entry.children = new Map();
      for (const [key, childSerialized] of serialized.children) {
        const child = this.deserializeEntry(childSerialized);
        child.parent = entry;
        entry.children.set(key, child);
      }
    }

    return entry;
  }

  /**
   * Simulate file system latency
   */
  private async simulateLatency(): Promise<void> {
    if (this.config.simulateLatency && this.config.latencyMs! > 0) {
      await new Promise(resolve => setTimeout(resolve, this.config.latencyMs));
    }
  }
}