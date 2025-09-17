// Mock Obsidian API for testing

export class App {
  vault = new Vault();
  workspace = new Workspace();
  metadataCache = new MetadataCache();
  fileManager = new FileManager();
  plugins = {
    enabledPlugins: new Set(['notion-api-importer']),
    plugins: {},
  };
}

export class Vault {
  adapter = new FileSystemAdapter();

  async create(path: string, data: string) {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() || '';
    file.basename = file.name.split('.')[0] || '';
    file.extension = file.name.split('.').pop() || '';
    return file;
  }

  async createFolder(path: string) {
    const folder = new TFolder();
    folder.path = path;
    folder.name = path.split('/').pop() || '';
    return folder;
  }

  async exists(path: string): Promise<boolean> {
    return false;
  }

  async modify(file: TFile, data: string) {
    return Promise.resolve();
  }

  async read(file: TFile): Promise<string> {
    return '';
  }

  async delete(file: TAbstractFile) {
    return Promise.resolve();
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return null;
  }

  getAllLoadedFiles(): TAbstractFile[] {
    return [];
  }

  getFolderByPath(path: string): TFolder | null {
    const folder = new TFolder();
    folder.path = path;
    folder.name = path.split('/').pop() || '';
    return folder;
  }

  getMarkdownFiles(): TFile[] {
    return [];
  }

  getFiles(): TFile[] {
    return [];
  }

  getName(): string {
    return 'Test Vault';
  }
}

export class Workspace {
  activeLeaf = null;
  leftSplit = new WorkspaceSplit();
  rightSplit = new WorkspaceSplit();
  rootSplit = new WorkspaceSplit();

  getLeaf(newLeaf?: boolean) {
    return new WorkspaceLeaf();
  }

  on(name: string, callback: (...args: any[]) => any, ctx?: any) {
    return { fn: callback };
  }

  off(name: string, callback: (...args: any[]) => any) {}

  trigger(name: string, ...data: any[]) {}

  openLinkText(linktext: string, sourcePath: string, newLeaf?: boolean) {}
}

export class WorkspaceSplit {}

export class WorkspaceLeaf {
  view = null;

  openFile(file: TFile) {
    return Promise.resolve();
  }

  setViewState(viewState: any) {
    return Promise.resolve();
  }
}

export class MetadataCache {
  getFileCache(file: TFile) {
    return null;
  }

  on(name: string, callback: (...args: any[]) => any, ctx?: any) {
    return { fn: callback };
  }

  off(name: string, callback: (...args: any[]) => any) {}

  trigger(name: string, ...data: any[]) {}
}

export class FileManager {
  generateMarkdownLink(file: TFile, sourcePath: string, subpath?: string, alias?: string) {
    return `[[${file.basename}]]`;
  }

  getNewFileParent(sourcePath: string) {
    return new TFolder();
  }
}

export class FileSystemAdapter {
  private files = new Map<string, string>();
  private folders = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async read(path: string): Promise<string> {
    return this.files.get(path) || '';
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
    // Ensure parent directories exist
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (dir) this.folders.add(dir);
    }
  }

  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
    // Ensure parent directories exist
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (dir) this.folders.add(dir);
    }
  }

  async list(path: string) {
    const files: string[] = [];
    const folders: string[] = [];

    for (const [filePath] of this.files) {
      if (filePath.startsWith(path + '/')) {
        const relativePath = filePath.substring(path.length + 1);
        if (!relativePath.includes('/')) {
          files.push(relativePath);
        }
      }
    }

    for (const folderPath of this.folders) {
      if (folderPath.startsWith(path + '/')) {
        const relativePath = folderPath.substring(path.length + 1);
        if (!relativePath.includes('/')) {
          folders.push(relativePath);
        }
      }
    }

    return { files, folders };
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
    this.folders.delete(path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.files.has(oldPath)) {
      const data = this.files.get(oldPath)!;
      this.files.delete(oldPath);
      this.files.set(newPath, data);
    }
    if (this.folders.has(oldPath)) {
      this.folders.delete(oldPath);
      this.folders.add(newPath);
    }
  }

  async copy(src: string, dest: string): Promise<void> {
    if (this.files.has(src)) {
      const data = this.files.get(src)!;
      this.files.set(dest, data);
    }
  }

  path = {
    join: (...parts: string[]) => parts.join('/'),
    dirname: (path: string) => path.split('/').slice(0, -1).join('/'),
    basename: (path: string) => path.split('/').pop() || '',
    extname: (path: string) => {
      const basename = path.split('/').pop() || '';
      const lastDot = basename.lastIndexOf('.');
      return lastDot > 0 ? basename.substring(lastDot) : '';
    }
  };
}

export abstract class TAbstractFile {
  name: string = '';
  path: string = '';
  parent: TFolder | null = null;
  vault: Vault = new Vault();
}

export class TFile extends TAbstractFile {
  basename: string = '';
  extension: string = '';
  stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];

  isRoot(): boolean {
    return this.parent === null;
  }
}

export class Plugin {
  app: App;
  manifest: any;

  constructor(app: App, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }

  async loadData(): Promise<any> {
    return {};
  }

  async saveData(data: any): Promise<void> {}

  addCommand(command: any) {}

  addRibbonIcon(icon: string, title: string, callback: () => any) {}

  addSettingTab(settingTab: any) {}

  async onload() {}

  onunload() {}
}

export class PluginSettingTab {
  constructor(app: App, plugin: Plugin) {}

  display(): void {}

  hide(): void {}
}

export class Setting {
  constructor(containerEl: HTMLElement) {}

  setName(name: string): this {
    return this;
  }

  setDesc(desc: string): this {
    return this;
  }

  addText(cb: (text: any) => any): this {
    cb({
      setPlaceholder: () => ({}),
      setValue: () => ({}),
      onChange: () => ({}),
    });
    return this;
  }

  addToggle(cb: (toggle: any) => any): this {
    cb({
      setValue: () => ({}),
      onChange: () => ({}),
    });
    return this;
  }

  addDropdown(cb: (dropdown: any) => any): this {
    cb({
      addOption: () => ({}),
      setValue: () => ({}),
      onChange: () => ({}),
    });
    return this;
  }
}

export class Notice {
  constructor(message: string, timeout?: number) {}
}

export class Modal {
  app: App;
  containerEl: HTMLElement = document.createElement('div');
  titleEl: HTMLElement = document.createElement('div');
  contentEl: HTMLElement = document.createElement('div');

  constructor(app: App) {
    this.app = app;
  }

  open() {}

  close() {}

  onOpen() {}

  onClose() {}
}

export class Component {
  _loaded: boolean = false;

  load() {
    this._loaded = true;
  }

  unload() {
    this._loaded = false;
  }

  addChild<T extends Component>(component: T): T {
    return component;
  }

  removeChild<T extends Component>(component: T): T {
    return component;
  }

  register(cb: () => any) {}

  registerEvent(eventRef: any) {}

  registerDomEvent(el: HTMLElement, type: string, callback: any) {}

  registerInterval(id: number) {}
}

export const Platform = {
  get isDesktopApp() { return true; },
  get isMobileApp() { return false; },
  get isPhone() { return false; },
  get isTablet() { return false; },
  get isMacOS() { return false; },
  get isWin() { return true; },
  get isLinux() { return false; },
  get isIosApp() { return false; },
  get isAndroidApp() { return false; },
  get isSafari() { return false; },
};

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

export function addIcon(iconId: string, svgContent: string) {}

export function setIcon(el: HTMLElement, iconId: string) {}

export function requestUrl(request: any): Promise<any> {
  return Promise.resolve({
    status: 200,
    headers: {},
    text: '',
    json: {},
    arrayBuffer: new ArrayBuffer(0),
  });
}

// Global mock
(global as any).Platform = Platform;