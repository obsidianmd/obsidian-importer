/**
 * Polyfills for Jest test environment
 * Provides browser APIs that are missing in Node.js environment
 */

// TransformStream polyfill for @zip.js/zip.js
if (!global.TransformStream) {
  global.TransformStream = class MockTransformStream {
    readable: ReadableStream;
    writable: WritableStream;

    constructor(transformer?: any) {
      this.readable = new ReadableStream();
      this.writable = new WritableStream();
    }
  };
}

// ReadableStream polyfill
if (!global.ReadableStream) {
  global.ReadableStream = class MockReadableStream {
    constructor(underlyingSource?: any) {}
    getReader() {
      return {
        read: () => Promise.resolve({ done: true, value: undefined }),
        releaseLock: () => {},
        cancel: () => Promise.resolve(),
      };
    }
    cancel() {
      return Promise.resolve();
    }
    pipeTo() {
      return Promise.resolve();
    }
    pipeThrough() {
      return this;
    }
  };
}

// WritableStream polyfill
if (!global.WritableStream) {
  global.WritableStream = class MockWritableStream {
    constructor(underlyingSink?: any) {}
    getWriter() {
      return {
        write: () => Promise.resolve(),
        close: () => Promise.resolve(),
        abort: () => Promise.resolve(),
        releaseLock: () => {},
      };
    }
    abort() {
      return Promise.resolve();
    }
  };
}

// CompressionStream polyfill
if (!global.CompressionStream) {
  global.CompressionStream = class MockCompressionStream extends TransformStream {
    constructor(format: string) {
      super();
    }
  };
}

// DecompressionStream polyfill
if (!global.DecompressionStream) {
  global.DecompressionStream = class MockDecompressionStream extends TransformStream {
    constructor(format: string) {
      super();
    }
  };
}

// URL.createObjectURL polyfill
if (!global.URL.createObjectURL) {
  global.URL.createObjectURL = () => 'blob:mock-url';
}

if (!global.URL.revokeObjectURL) {
  global.URL.revokeObjectURL = () => {};
}

// Blob polyfill
if (!global.Blob) {
  global.Blob = class MockBlob {
    size: number = 0;
    type: string = '';

    constructor(parts?: any[], options?: any) {
      this.type = options?.type || '';
    }

    slice() {
      return new Blob();
    }

    stream() {
      return new ReadableStream();
    }

    text() {
      return Promise.resolve('');
    }

    arrayBuffer() {
      return Promise.resolve(new ArrayBuffer(0));
    }
  };
}

// File polyfill
if (!global.File) {
  global.File = class MockFile extends Blob {
    name: string;
    lastModified: number;

    constructor(bits: any[], name: string, options?: any) {
      super(bits, options);
      this.name = name;
      this.lastModified = Date.now();
    }
  };
}

// FileReader polyfill
if (!global.FileReader) {
  global.FileReader = class MockFileReader {
    result: any = null;
    error: any = null;
    readyState: number = 0;
    onload: any = null;
    onerror: any = null;
    onloadend: any = null;

    readAsText() {
      setTimeout(() => {
        this.result = '';
        this.readyState = 2;
        if (this.onload) this.onload({ target: this });
        if (this.onloadend) this.onloadend({ target: this });
      }, 0);
    }

    readAsArrayBuffer() {
      setTimeout(() => {
        this.result = new ArrayBuffer(0);
        this.readyState = 2;
        if (this.onload) this.onload({ target: this });
        if (this.onloadend) this.onloadend({ target: this });
      }, 0);
    }

    readAsDataURL() {
      setTimeout(() => {
        this.result = 'data:text/plain;base64,';
        this.readyState = 2;
        if (this.onload) this.onload({ target: this });
        if (this.onloadend) this.onloadend({ target: this });
      }, 0);
    }
  };
}

// TextEncoder/TextDecoder polyfills
if (!global.TextEncoder) {
  global.TextEncoder = class MockTextEncoder {
    encode(input: string) {
      return new Uint8Array(Buffer.from(input, 'utf8'));
    }
  };
}

if (!global.TextDecoder) {
  global.TextDecoder = class MockTextDecoder {
    decode(input: Uint8Array) {
      return Buffer.from(input).toString('utf8');
    }
  };
}

// Web Crypto API polyfill
if (!global.crypto) {
  global.crypto = {
    getRandomValues: (arr: any) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    },
    randomUUID: () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    },
  } as any;
}

// Performance API polyfill
if (!global.performance) {
  global.performance = {
    now: () => Date.now(),
    mark: () => {},
    measure: () => {},
    getEntriesByName: () => [],
    getEntriesByType: () => [],
  } as any;
}