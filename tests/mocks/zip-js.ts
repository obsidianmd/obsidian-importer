/**
 * Mock implementation of @zip.js/zip.js for testing
 */

export interface ZipEntry {
  filename: string;
  directory: boolean;
  getData?: (writer: any) => Promise<any>;
  compressedSize: number;
  uncompressedSize: number;
  lastModDate: Date;
}

export class ZipReader {
  entries: ZipEntry[] = [];

  constructor(reader: any) {
    // Mock constructor
  }

  async getEntries(): Promise<ZipEntry[]> {
    return this.entries;
  }

  async close(): Promise<void> {
    // Mock close
  }
}

export class ZipWriter {
  entries: ZipEntry[] = [];

  constructor(writer: any) {
    // Mock constructor
  }

  async add(name: string, reader: any, options?: any): Promise<ZipEntry> {
    const entry: ZipEntry = {
      filename: name,
      directory: false,
      compressedSize: 100,
      uncompressedSize: 200,
      lastModDate: new Date(),
    };
    this.entries.push(entry);
    return entry;
  }

  async close(): Promise<any> {
    return new Uint8Array(0);
  }
}

export class BlobReader {
  constructor(blob: Blob) {
    // Mock constructor
  }

  async init(): Promise<void> {
    // Mock init
  }

  async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    return new Uint8Array(length);
  }
}

export class BlobWriter {
  data: Blob = new Blob();

  constructor(mimeType?: string) {
    // Mock constructor
  }

  async init(): Promise<void> {
    // Mock init
  }

  async writeUint8Array(array: Uint8Array): Promise<void> {
    // Mock write
  }

  getData(): Blob {
    return this.data;
  }
}

export class TextReader {
  constructor(text: string) {
    // Mock constructor
  }

  async init(): Promise<void> {
    // Mock init
  }

  async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    return new Uint8Array(length);
  }
}

export class TextWriter {
  data: string = '';

  constructor(encoding?: string) {
    // Mock constructor
  }

  async init(): Promise<void> {
    // Mock init
  }

  async writeUint8Array(array: Uint8Array): Promise<void> {
    // Mock write
  }

  getData(): string {
    return this.data;
  }
}

export class Uint8ArrayReader {
  constructor(array: Uint8Array) {
    // Mock constructor
  }

  async init(): Promise<void> {
    // Mock init
  }

  async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    return new Uint8Array(length);
  }
}

export class Uint8ArrayWriter {
  data: Uint8Array = new Uint8Array(0);

  constructor() {
    // Mock constructor
  }

  async init(): Promise<void> {
    // Mock init
  }

  async writeUint8Array(array: Uint8Array): Promise<void> {
    this.data = array;
  }

  getData(): Uint8Array {
    return this.data;
  }
}

export class HttpReader {
  constructor(url: string) {
    // Mock constructor
  }

  async init(): Promise<void> {
    // Mock init
  }

  async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    return new Uint8Array(length);
  }
}

export class HttpRangeReader extends HttpReader {
  constructor(url: string) {
    super(url);
  }
}

// Configuration functions
export function configure(configuration: any): void {
  // Mock configure
}

export function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'zip':
      return 'application/zip';
    case 'txt':
      return 'text/plain';
    case 'json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

// Constants
export const ERR_HTTP_RANGE = 'HTTP_RANGE';
export const ERR_ITERATOR_COMPLETED_TOO_SOON = 'ITERATOR_COMPLETED_TOO_SOON';
export const ERR_BAD_FORMAT = 'BAD_FORMAT';
export const ERR_EOCDR_NOT_FOUND = 'EOCDR_NOT_FOUND';
export const ERR_EOCDR_LOCATOR_ZIP64_NOT_FOUND = 'EOCDR_LOCATOR_ZIP64_NOT_FOUND';
export const ERR_CENTRAL_DIRECTORY_NOT_FOUND = 'CENTRAL_DIRECTORY_NOT_FOUND';
export const ERR_LOCAL_FILE_HEADER_NOT_FOUND = 'LOCAL_FILE_HEADER_NOT_FOUND';
export const ERR_EXTRAFIELD_ZIP64_NOT_FOUND = 'EXTRAFIELD_ZIP64_NOT_FOUND';
export const ERR_ENCRYPTED = 'ENCRYPTED';
export const ERR_UNSUPPORTED_ENCRYPTION = 'UNSUPPORTED_ENCRYPTION';
export const ERR_UNSUPPORTED_COMPRESSION = 'UNSUPPORTED_COMPRESSION';
export const ERR_SPLIT_ZIP_FILE = 'SPLIT_ZIP_FILE';

// Export default for CJS compatibility
export default {
  ZipReader,
  ZipWriter,
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  HttpReader,
  HttpRangeReader,
  configure,
  getMimeType,
};