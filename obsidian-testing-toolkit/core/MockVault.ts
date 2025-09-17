/**
 * Obsidian Testing Toolkit - Mock Vault Implementation
 *
 * Complete implementation of Obsidian's Vault API for testing purposes.
 * Provides file operations, folder management, and metadata handling.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

import { EventEmitter } from 'events';
import { FileSystemMock } from '../utils/FileSystemMock';

/**
 * Mock implementation of Obsidian's TFile
 */
export class MockTFile {
  public path: string;
  public name: string;
  public basename: string;
  public extension: string;
  public stat: { ctime: number; mtime: number; size: number };
  public vault: MockVault;

  constructor(path: string, vault: MockVault) {
    this.path = path;
    this.vault = vault;
    this.name = path.split('/').pop() || '';

    const parts = this.name.split('.');
    if (parts.length > 1) {
      this.extension = parts.pop() || '';
      this.basename = parts.join('.');
    } else {
      this.extension = '';
      this.basename = this.name;
    }

    const now = Date.now();
    this.stat = {
      ctime: now,
      mtime: now,
      size: 0
    };
  }

  public updateStat(size: number = 0): void {
    this.stat.mtime = Date.now();
    this.stat.size = size;
  }
}

/**
 * Mock implementation of Obsidian's TFolder
 */
export class MockTFolder {
  public path: string;
  public name: string;
  public children: (MockTFile | MockTFolder)[] = [];
  public vault: MockVault;
  public parent: MockTFolder | null = null;

  constructor(path: string, vault: MockVault) {
    this.path = path;
    this.vault = vault;
    this.name = path.split('/').pop() || '';
  }

  public addChild(child: MockTFile | MockTFolder): void {
    child.parent = this;
    this.children.push(child);
  }

  public removeChild(child: MockTFile | MockTFolder): void {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }
}

/**
 * Configuration options for MockVault
 */
export interface MockVaultConfig {
  name: string;
  path: string;
  fileSystem: FileSystemMock;
  adapter?: 'memory' | 'filesystem';
  configDir?: string;
}

/**
 * Mock implementation of Obsidian's Vault
 */
export class MockVault extends EventEmitter {
  public adapter: any;
  public configDir: string;
  public name: string;
  public path: string;

  private fileSystem: FileSystemMock;
  private files: Map<string, MockTFile> = new Map();
  private folders: Map<string, MockTFolder> = new Map();
  private fileContents: Map<string, string> = new Map();
  private config: MockVaultConfig;

  constructor(config: MockVaultConfig) {
    super();
    this.config = config;
    this.name = config.name;
    this.path = config.path;
    this.configDir = config.configDir || `${config.path}/.obsidian`;
    this.fileSystem = config.fileSystem;

    // Create root folder
    const rootFolder = new MockTFolder('', this);
    this.folders.set('', rootFolder);

    // Mock adapter
    this.adapter = {
      getName: () => this.name,
      getBasePath: () => this.path,
      getFullPath: (path: string) => `${this.path}/${path}`,
      exists: (path: string) => this.exists(path),
      stat: (path: string) => this.getFileByPath(path)?.stat,
      read: (path: string) => this.read(path),
      write: (path: string, data: string) => this.modify(this.getFileByPath(path)!, data),
      mkdir: (path: string) => this.createFolder(path),
      remove: (path: string) => this.delete(this.getAbstractFileByPath(path)!)
    };
  }

  /**
   * Get all files in the vault
   */
  public getFiles(): MockTFile[] {
    return Array.from(this.files.values());
  }

  /**
   * Get all folders in the vault
   */
  public getFolders(): MockTFolder[] {
    return Array.from(this.folders.values()).filter(f => f.path !== '');
  }

  /**
   * Get all abstract files (files and folders)
   */
  public getAllLoadedFiles(): (MockTFile | MockTFolder)[] {
    return [...this.getFiles(), ...this.getFolders()];
  }

  /**
   * Get file by path
   */
  public getFileByPath(path: string): MockTFile | null {
    return this.files.get(this.normalizePath(path)) || null;
  }

  /**
   * Get folder by path
   */
  public getFolderByPath(path: string): MockTFolder | null {
    return this.folders.get(this.normalizePath(path)) || null;
  }

  /**
   * Get abstract file by path (file or folder)
   */
  public getAbstractFileByPath(path: string): MockTFile | MockTFolder | null {
    const normalizedPath = this.normalizePath(path);
    return this.files.get(normalizedPath) || this.folders.get(normalizedPath) || null;
  }

  /**
   * Check if a file or folder exists
   */
  public exists(path: string): boolean {
    const normalizedPath = this.normalizePath(path);
    return this.files.has(normalizedPath) || this.folders.has(normalizedPath);
  }

  /**
   * Create a new file
   */
  public async create(path: string, data: string = ''): Promise<MockTFile> {
    const normalizedPath = this.normalizePath(path);

    if (this.exists(normalizedPath)) {
      throw new Error(`File already exists: ${normalizedPath}`);
    }

    // Ensure parent folder exists
    const parentPath = this.getParentPath(normalizedPath);
    if (parentPath && !this.folders.has(parentPath)) {
      await this.createFolder(parentPath);
    }

    const file = new MockTFile(normalizedPath, this);
    file.updateStat(data.length);

    this.files.set(normalizedPath, file);
    this.fileContents.set(normalizedPath, data);

    // Add to parent folder
    const parentFolder = this.folders.get(parentPath || '');
    if (parentFolder) {
      parentFolder.addChild(file);
    }

    this.emit('create', file);
    return file;
  }

  /**
   * Create a new folder
   */
  public async createFolder(path: string): Promise<MockTFolder> {
    const normalizedPath = this.normalizePath(path);

    if (this.exists(normalizedPath)) {
      throw new Error(`Folder already exists: ${normalizedPath}`);
    }

    // Ensure parent folder exists
    const parentPath = this.getParentPath(normalizedPath);
    if (parentPath && !this.folders.has(parentPath)) {
      await this.createFolder(parentPath);
    }

    const folder = new MockTFolder(normalizedPath, this);
    this.folders.set(normalizedPath, folder);

    // Add to parent folder
    const parentFolder = this.folders.get(parentPath || '');
    if (parentFolder) {
      parentFolder.addChild(folder);
    }

    this.emit('create', folder);
    return folder;
  }

  /**
   * Read file contents
   */
  public async read(file: MockTFile | string): Promise<string> {
    const path = typeof file === 'string' ? file : file.path;
    const normalizedPath = this.normalizePath(path);

    if (!this.files.has(normalizedPath)) {
      throw new Error(`File not found: ${normalizedPath}`);
    }

    return this.fileContents.get(normalizedPath) || '';
  }

  /**
   * Read file as binary
   */
  public async readBinary(file: MockTFile | string): Promise<ArrayBuffer> {
    const content = await this.read(file);
    const encoder = new TextEncoder();
    return encoder.encode(content).buffer;
  }

  /**
   * Modify file contents
   */
  public async modify(file: MockTFile, data: string): Promise<void> {
    const normalizedPath = this.normalizePath(file.path);

    if (!this.files.has(normalizedPath)) {
      throw new Error(`File not found: ${normalizedPath}`);
    }

    this.fileContents.set(normalizedPath, data);
    file.updateStat(data.length);

    this.emit('modify', file);
  }

  /**
   * Write binary data to file
   */
  public async writeBinary(file: MockTFile, data: ArrayBuffer): Promise<void> {
    const decoder = new TextDecoder();
    const textData = decoder.decode(data);
    await this.modify(file, textData);
  }

  /**
   * Append data to file
   */
  public async append(file: MockTFile, data: string): Promise<void> {
    const currentContent = await this.read(file);
    await this.modify(file, currentContent + data);
  }

  /**
   * Copy file to new location
   */
  public async copy(file: MockTFile, newPath: string): Promise<MockTFile> {
    const content = await this.read(file);
    return await this.create(newPath, content);
  }

  /**
   * Rename file or folder
   */
  public async rename(file: MockTFile | MockTFolder, newPath: string): Promise<void> {
    const oldPath = file.path;
    const normalizedNewPath = this.normalizePath(newPath);

    if (this.exists(normalizedNewPath)) {
      throw new Error(`Target already exists: ${normalizedNewPath}`);
    }

    if (file instanceof MockTFile) {
      const content = this.fileContents.get(oldPath) || '';

      // Remove from old location
      this.files.delete(oldPath);
      this.fileContents.delete(oldPath);

      // Add to new location
      file.path = normalizedNewPath;
      const parts = normalizedNewPath.split('/');
      file.name = parts[parts.length - 1];

      this.files.set(normalizedNewPath, file);
      this.fileContents.set(normalizedNewPath, content);
    } else {
      // Handle folder rename
      this.folders.delete(oldPath);
      file.path = normalizedNewPath;
      file.name = normalizedNewPath.split('/').pop() || '';
      this.folders.set(normalizedNewPath, file);

      // Rename all children recursively
      await this.renameFolderContents(oldPath, normalizedNewPath);
    }

    this.emit('rename', file, oldPath);
  }

  /**
   * Delete file or folder
   */
  public async delete(file: MockTFile | MockTFolder): Promise<void> {
    const path = file.path;

    if (file instanceof MockTFile) {
      this.files.delete(path);
      this.fileContents.delete(path);
    } else {
      // Delete folder and all contents
      await this.deleteFolderContents(file);
      this.folders.delete(path);
    }

    // Remove from parent folder
    if (file.parent) {
      file.parent.removeChild(file);
    }

    this.emit('delete', file);
  }

  /**
   * Get markdown files
   */
  public getMarkdownFiles(): MockTFile[] {
    return this.getFiles().filter(file => file.extension === 'md');
  }

  /**
   * Generate unique path
   */
  public getAvailablePath(path: string, extension?: string): string {
    let counter = 0;
    let testPath = extension ? `${path}.${extension}` : path;

    while (this.exists(testPath)) {
      counter++;
      const basePath = extension ? path : path.replace(/\.[^.]*$/, '');
      const ext = extension || path.split('.').pop() || '';
      testPath = `${basePath} ${counter}${ext ? '.' + ext : ''}`;
    }

    return testPath;
  }

  /**
   * Process file - simulate Obsidian's file processing
   */
  public async process(file: MockTFile, fn: (data: string) => string): Promise<string> {
    const content = await this.read(file);
    const processedContent = fn(content);
    await this.modify(file, processedContent);
    return processedContent;
  }

  /**
   * Get vault configuration
   */
  public getConfig(key: string): any {
    // Mock configuration storage
    return null;
  }

  /**
   * Set vault configuration
   */
  public setConfig(key: string, value: any): void {
    // Mock configuration storage
  }

  /**
   * Create snapshot of current vault state
   */
  public getSnapshot(): any {
    return {
      files: Array.from(this.files.entries()).map(([path, file]) => ({
        path,
        content: this.fileContents.get(path) || '',
        stat: { ...file.stat }
      })),
      folders: Array.from(this.folders.entries()).map(([path, folder]) => ({
        path,
        name: folder.name
      })),
      timestamp: Date.now()
    };
  }

  /**
   * Restore vault from snapshot
   */
  public async restoreFromSnapshot(snapshot: any): Promise<void> {
    // Clear current state
    this.files.clear();
    this.folders.clear();
    this.fileContents.clear();

    // Restore root folder
    const rootFolder = new MockTFolder('', this);
    this.folders.set('', rootFolder);

    // Restore folders
    for (const folderData of snapshot.folders) {
      if (folderData.path !== '') {
        const folder = new MockTFolder(folderData.path, this);
        this.folders.set(folderData.path, folder);
      }
    }

    // Restore files
    for (const fileData of snapshot.files) {
      const file = new MockTFile(fileData.path, this);
      file.stat = { ...fileData.stat };
      this.files.set(fileData.path, file);
      this.fileContents.set(fileData.path, fileData.content);
    }

    this.emit('snapshot-restored', snapshot);
  }

  /**
   * Normalize file path
   */
  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
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
   * Rename folder contents recursively
   */
  private async renameFolderContents(oldPath: string, newPath: string): Promise<void> {
    const files = Array.from(this.files.keys()).filter(path => path.startsWith(oldPath + '/'));
    const folders = Array.from(this.folders.keys()).filter(path => path.startsWith(oldPath + '/'));

    // Rename files
    for (const filePath of files) {
      const relativePath = filePath.substring(oldPath.length + 1);
      const newFilePath = `${newPath}/${relativePath}`;

      const file = this.files.get(filePath)!;
      const content = this.fileContents.get(filePath) || '';

      this.files.delete(filePath);
      this.fileContents.delete(filePath);

      file.path = newFilePath;
      this.files.set(newFilePath, file);
      this.fileContents.set(newFilePath, content);
    }

    // Rename folders
    for (const folderPath of folders) {
      const relativePath = folderPath.substring(oldPath.length + 1);
      const newFolderPath = `${newPath}/${relativePath}`;

      const folder = this.folders.get(folderPath)!;
      this.folders.delete(folderPath);

      folder.path = newFolderPath;
      this.folders.set(newFolderPath, folder);
    }
  }

  /**
   * Delete folder contents recursively
   */
  private async deleteFolderContents(folder: MockTFolder): Promise<void> {
    const children = [...folder.children];

    for (const child of children) {
      if (child instanceof MockTFile) {
        await this.delete(child);
      } else {
        await this.deleteFolderContents(child);
        await this.delete(child);
      }
    }
  }
}