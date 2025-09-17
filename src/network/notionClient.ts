// [SIG-FLD-VAL-001] Declared in posture, amplified in field.
// Notion Data Sources client — enforces Notion-Version and governance constraints.
// Contracts: SIG-SYS-NOT-027 (Secrets & Privacy)

export type NotionClientOptions = {
  baseUrl?: string;
  token?: string | null; // keep in memory by default; do not persist by default
  allowLegacy?: boolean;
  downgradeNote?: string;
  timeoutMs?: number; // default 30000
  maxRedirects?: number; // default 3
};

export type NotionRequest = {
  path: string; // e.g., "/v1/data-sources/query"
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
};

export class NotionClient {
  private baseUrl: string;
  private token: string | null;
  private allowLegacy: boolean;
  private downgradeNote?: string;
  private timeoutMs: number;
  private maxRedirects: number;

  constructor(opts: NotionClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? 'https://api.notion.com';
    this.token = opts.token ?? null;
    this.allowLegacy = !!opts.allowLegacy;
    this.downgradeNote = opts.downgradeNote;
    this.timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 30000;
    this.maxRedirects = typeof opts.maxRedirects === 'number' ? opts.maxRedirects : 3;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  async request<T = unknown>(req: NotionRequest): Promise<T> {
    this.ensureCompliantPath(req.path);

    const url = this.baseUrl.replace(/\/$/, '') + req.path;
    const headers: Record<string, string> = {
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json',
      ...req.headers,
    };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);

    let redirectCount = 0;
    let currentUrl = url;
    let res: Response | null = null;

    try {
      // Simple redirect handling (maxRedirects)
      // Note: Obsidian environment provides fetch; no Node imports here.
      // @ts-ignore - fetch available in plugin runtime
      while (true) {
        res = await fetch(currentUrl, {
          method: req.method ?? 'POST',
          headers,
          body: req.body != null ? JSON.stringify(req.body) : undefined,
          signal: controller.signal,
        });
        const status = res.status;
        if (status >= 300 && status < 400 && redirectCount < this.maxRedirects) {
          const loc = res.headers.get('location');
          if (!loc) break;
          redirectCount++;
          currentUrl = loc;
          continue;
        }
        break;
      }
    } finally {
      clearTimeout(id);
    }

    if (!res) throw new Error('Network error: no response');
    if (res.status >= 400) {
      const text = await res.text().catch(() => '');
      throw new Error(`Notion API error ${res.status}: ${text}`);
    }

    // @ts-ignore - Response#json exists
    return (await res.json()) as T;
  }

  private ensureCompliantPath(path: string) {
    // Enforce Data Sources usage; block legacy DB endpoints unless allowLegacy is set explicitly with a downgrade note
    const lower = path.toLowerCase();
    const usingDataSources = lower.includes('/data-sources');
    const usingLegacyDb = lower.includes('/databases');

    if (usingLegacyDb && !usingDataSources) {
      if (!this.allowLegacy) {
        throw new Error(
          'Legacy Notion database endpoints are blocked. Use Data Sources (see docs/DOCS.md). If unavoidable, initialize client with { allowLegacy: true, downgradeNote } and document the downgrade.'
        );
      }
      if (!this.downgradeNote) {
        throw new Error('allowLegacy requires a downgradeNote to be provided.');
      }
    }
  }
}
