import { FormatImporter } from '../format-importer';
import { Notice, requestUrl, normalizePath, Setting, Modal, App } from 'obsidian';
import { ImportContext } from '../main';

interface NotionApiConfig {
    apiKey: string;
    attachmentFolder: string;
}

interface NotionPage {
    id: string;
    properties: any;
    created_time: string;
    last_edited_time: string;
    parent: any;
    archived: boolean;
    url: string;
}

interface NotionBlock {
    id: string;
    type: string;
    has_children?: boolean;
    [key: string]: any;
}

interface NotionDatabase {
    id: string;
    title: any[];
    properties: Record<string, any>;
    parent: any;
    url: string;
}

export class NotionApiImporter extends FormatImporter {
    private config: NotionApiConfig;
    private rateLimitDelay = 334; // 3 requests per second as per Notion API limits
    private lastRequestTime = 0;

    getName(): string {
        return 'Notion (API)';
    }

    getDescription(): string {
        return 'Import from Notion using the official API. Supports databases, pages, and all property types including Database to Bases conversion.';
    }

    init(): void {
        this.config = {
            apiKey: '',
            attachmentFolder: 'attachments'
        };

        this.addOutputLocationSetting('Notion API Import');

        new Setting(this.modal.contentEl)
            .setName('Notion Integration Token')
            .setDesc('Enter your Notion Integration Token. Create one at https://www.notion.so/my-integrations')
            .addText(text => text
                .setPlaceholder('secret_...')
                .setValue(this.config.apiKey)
                .onChange(value => this.config.apiKey = value));

        new Setting(this.modal.contentEl)
            .setName('Attachment Folder')
            .setDesc('Folder to store images and attachments')
            .addText(text => text
                .setValue(this.config.attachmentFolder)
                .onChange(value => this.config.attachmentFolder = value));
    }

    async import(ctx: ImportContext): Promise<void> {
        const { vault } = ctx;
        
        if (!this.config.apiKey) {
            new Notice('Please enter your Notion Integration Token');
            return;
        }

        const folder = await this.getOutputFolder();
        if (!folder) {
            new Notice('Please select a location to export to.');
            return;
        }

        let targetFolderPath = normalizePath(folder.path);
        if (!targetFolderPath.endsWith('/')) targetFolderPath += '/';

        try {
            ctx.status('Connecting to Notion API...');
            
            // Search for all pages and databases
            const results = await this.searchNotionContent();
            
            if (results.length === 0) {
                new Notice('No content found in Notion workspace. Make sure your integration has access to the pages.');
                return;
            }

            ctx.status(`Found ${results.length} items to import`);

            // Separate databases and pages
            const databases = results.filter(item => item.object === 'database');
            const pages = results.filter(item => item.object === 'page');

            let current = 0;
            const total = results.length;

            // Process databases first (for Bases conversion)
            for (const database of databases) {
                if (ctx.isCancelled()) return;
                current++;
                ctx.reportProgress(current, total);
                ctx.status(`Importing database: ${this.getDatabaseTitle(database)}`);
                await this.importDatabase(ctx, database, targetFolderPath);
            }

            // Process standalone pages
            for (const page of pages) {
                if (ctx.isCancelled()) return;
                
                // Skip if page belongs to a database (already processed)
                if (page.parent?.type === 'database_id') continue;
                
                current++;
                ctx.reportProgress(current, total);
                ctx.status(`Importing page: ${this.getPageTitle(page)}`);
                await this.importPage(ctx, page, targetFolderPath);
            }

            new Notice(`Successfully imported ${results.length} items from Notion`);
        } catch (error: any) {
            console.error('Notion API import error:', error);
            new Notice(`Import failed: ${error.message}`);
            ctx.reportFailed('', error);
        }
    }

    private async notionRequest(endpoint: string, method = 'GET', body?: any): Promise<any> {
        // Rate limiting
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.rateLimitDelay) {
            await this.sleep(this.rateLimitDelay - timeSinceLastRequest);
        }
        this.lastRequestTime = Date.now();

        try {
            const response = await requestUrl({
                url: `https://api.notion.com/v1/${endpoint}`,
                method,
                headers: {
                    'Authorization': `Bearer ${this.config.apiKey}`,
                    'Notion-Version': '2022-06-28',
                    'Content-Type': 'application/json'
                },
                body: body ? JSON.stringify(body) : undefined
            });

            if (response.status !== 200) {
                throw new Error(`Notion API error: ${response.status} - ${response.text}`);
            }

            return response.json;
        } catch (error: any) {
            if (error.message?.includes('401')) {
                throw new Error('Invalid API token. Please check your Notion Integration Token.');
            }
            throw error;
        }
    }

    private async searchNotionContent(): Promise<any[]> {
        const results: any[] = [];
        let hasMore = true;
        let cursor: string | undefined;

        while (hasMore) {
            const response = await this.notionRequest('search', 'POST', {
                start_cursor: cursor,
                page_size: 100
            });

            results.push(...response.results);
            hasMore = response.has_more;
            cursor = response.next_cursor;
        }

        return results;
    }

    private async importPage(ctx: ImportContext, page: NotionPage, targetFolder: string): Promise<void> {
        const { vault } = ctx;
        
        try {
            // Get page content blocks
            const blocks = await this.getPageBlocks(page.id);
            
            // Convert to markdown
            const title = this.getPageTitle(page);
            const markdown = await this.blocksToMarkdown(ctx, blocks);
            
            // Create file path
            const fileName = this.sanitizeFileName(title) + '.md';
            const filePath = normalizePath(targetFolder + fileName);
            
            // Add frontmatter
            const frontmatter = this.createFrontmatter(page);
            const content = frontmatter + markdown;
            
            // Create file with metadata
            await vault.create(filePath, content, {
                ctime: new Date(page.created_time).getTime(),
                mtime: new Date(page.last_edited_time).getTime()
            });

            ctx.reportNoteSuccess(filePath);
        } catch (error: any) {
            ctx.reportFailed(page.id, error);
        }
    }

    private async importDatabase(ctx: ImportContext, database: NotionDatabase, targetFolder: string): Promise<void> {
        const { vault } = ctx;
        
        try {
            // Get database title
            const title = this.getDatabaseTitle(database);
            const dbFolderName = this.sanitizeFileName(title);
            const dbFolderPath = normalizePath(targetFolder + dbFolderName + '/');
            
            // Create folder for database (Bases conversion)
            await this.createFolders(dbFolderPath);
            
            // Query database for all pages
            const pages = await this.queryDatabase(database.id);
            
            // Create database overview/index file (for Bases)
            const overviewContent = this.createDatabaseOverview(database, pages);
            const overviewPath = normalizePath(dbFolderPath + '_index.md');
            await vault.create(overviewPath, overviewContent);
            ctx.reportNoteSuccess(overviewPath);
            
            // Import each page in the database
            for (const page of pages) {
                if (ctx.isCancelled()) return;
                
                const pageTitle = this.getPageTitle(page);
                const blocks = await this.getPageBlocks(page.id);
                const markdown = await this.blocksToMarkdown(ctx, blocks);
                
                // Add properties as frontmatter
                const frontmatter = this.createDatabasePageFrontmatter(page, database);
                const content = frontmatter + markdown;
                
                const fileName = this.sanitizeFileName(pageTitle) + '.md';
                const filePath = normalizePath(dbFolderPath + fileName);
                
                await vault.create(filePath, content, {
                    ctime: new Date(page.created_time).getTime(),
                    mtime: new Date(page.last_edited_time).getTime()
                });
                
                ctx.reportNoteSuccess(filePath);
            }
        } catch (error: any) {
            ctx.reportFailed(database.id, error);
        }
    }

    private async queryDatabase(databaseId: string): Promise<any[]> {
        const pages: any[] = [];
        let hasMore = true;
        let cursor: string | undefined;

        while (hasMore) {
            const response = await this.notionRequest(`databases/${databaseId}/query`, 'POST', {
                start_cursor: cursor,
                page_size: 100
            });

            pages.push(...response.results);
            hasMore = response.has_more;
            cursor = response.next_cursor;
        }

        return pages;
    }

    private async getPageBlocks(pageId: string): Promise<NotionBlock[]> {
        const blocks: NotionBlock[] = [];
        let hasMore = true;
        let cursor: string | undefined;

        while (hasMore) {
            const params = cursor ? `?start_cursor=${cursor}` : '';
            const response = await this.notionRequest(`blocks/${pageId}/children${params}`);
            
            // Process blocks and handle nested structures
            for (const block of response.results) {
                blocks.push(block);
                
                // Recursively get child blocks if they exist
                if (block.has_children) {
                    const children = await this.getPageBlocks(block.id);
                    blocks.push(...children);
                }
            }
            
            hasMore = response.has_more;
            cursor = response.next_cursor;
        }

        return blocks;
    }

    private async blocksToMarkdown(ctx: ImportContext, blocks: NotionBlock[]): Promise<string> {
        const markdownParts: string[] = [];
        let listItems: string[] = [];
        let currentListType: string | null = null;

        for (const block of blocks) {
            // Handle list grouping
            if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item') {
                if (currentListType !== block.type) {
                    if (listItems.length > 0) {
                        markdownParts.push(listItems.join('\n'));
                        listItems = [];
                    }
                    currentListType = block.type;
                }
                const prefix = block.type === 'bulleted_list_item' ? '- ' : '1. ';
                listItems.push(prefix + this.richTextToMarkdown(block[block.type].rich_text));
            } else {
                // Flush any pending list items
                if (listItems.length > 0) {
                    markdownParts.push(listItems.join('\n'));
                    listItems = [];
                    currentListType = null;
                }
                
                const markdown = await this.blockToMarkdown(ctx, block);
                if (markdown) {
                    markdownParts.push(markdown);
                }
            }
        }

        // Flush any remaining list items
        if (listItems.length > 0) {
            markdownParts.push(listItems.join('\n'));
        }

        return markdownParts.join('\n\n');
    }

    private async blockToMarkdown(ctx: ImportContext, block: NotionBlock): Promise<string> {
        switch (block.type) {
            case 'paragraph':
                return this.richTextToMarkdown(block.paragraph.rich_text);
            
            case 'heading_1':
                return `# ${this.richTextToMarkdown(block.heading_1.rich_text)}`;
            
            case 'heading_2':
                return `## ${this.richTextToMarkdown(block.heading_2.rich_text)}`;
            
            case 'heading_3':
                return `### ${this.richTextToMarkdown(block.heading_3.rich_text)}`;
            
            case 'to_do':
                const checked = block.to_do.checked ? 'x' : ' ';
                return `- [${checked}] ${this.richTextToMarkdown(block.to_do.rich_text)}`;
            
            case 'toggle':
                return `> ${this.richTextToMarkdown(block.toggle.rich_text)}`;
            
            case 'code':
                const language = block.code.language || '';
                const codeText = this.richTextToMarkdown(block.code.rich_text);
                return `\`\`\`${language}\n${codeText}\n\`\`\``;
            
            case 'quote':
                return `> ${this.richTextToMarkdown(block.quote.rich_text)}`;
            
            case 'divider':
                return '---';
            
            case 'callout':
                const icon = block.callout.icon?.emoji || '💡';
                const calloutText = this.richTextToMarkdown(block.callout.rich_text);
                return `> [!info] ${icon} ${calloutText}`;
            
            case 'image':
                return await this.handleImage(ctx, block.image);
            
            case 'video':
            case 'file':
            case 'pdf':
                return await this.handleFile(ctx, block[block.type], block.type);
            
            case 'bookmark':
                const bookmarkUrl = block.bookmark.url;
                return `[Bookmark](${bookmarkUrl})`;
            
            case 'equation':
                return `$$${block.equation.expression}$$`;
            
            case 'table_of_contents':
                return `[[Table of Contents]]`;
            
            default:
                console.warn(`Unsupported Notion block type: ${block.type}`);
                return '';
        }
    }

    private richTextToMarkdown(richTextArray: any[]): string {
        if (!richTextArray || richTextArray.length === 0) return '';

        return richTextArray.map(text => {
            let content = text.plain_text || '';

            // Apply annotations
            if (text.annotations) {
                if (text.annotations.bold) content = `**${content}**`;
                if (text.annotations.italic) content = `*${content}*`;
                if (text.annotations.strikethrough) content = `~~${content}~~`;
                if (text.annotations.code) content = `\`${content}\``;
                if (text.annotations.underline) content = `<u>${content}</u>`;
            }

            // Add link if present
            if (text.href) {
                content = `[${content}](${text.href})`;
            }

            return content;
        }).join('');
    }

    private async handleImage(ctx: ImportContext, image: any): Promise<string> {
        const { vault } = ctx;
        const url = image.type === 'external' ? image.external.url : image.file?.url;
        
        if (!url) return '';

        try {
            const response = await requestUrl({ url });
            const arrayBuffer = await response.arrayBuffer;
            
            // Generate filename
            const extension = this.getFileExtension(url);
            const fileName = `notion_${Date.now()}${extension}`;
            const filePath = normalizePath(`${this.config.attachmentFolder}/${fileName}`);
            
            // Ensure attachment folder exists
            await this.createFolders(this.config.attachmentFolder + '/');
            
            // Save image
            await vault.createBinary(filePath, arrayBuffer);
            
            // Return Obsidian image embed
            return `![[${fileName}]]`;
        } catch (error) {
            console.error('Failed to download image:', error);
            return `![Image](${url})`;
        }
    }

    private async handleFile(ctx: ImportContext, file: any, type: string): Promise<string> {
        const { vault } = ctx;
        const url = file.type === 'external' ? file.external.url : file.file?.url;
        const name = file.name || `${type}_${Date.now()}`;
        
        if (!url) return '';

        try {
            const response = await requestUrl({ url });
            const arrayBuffer = await response.arrayBuffer;
            
            const extension = this.getFileExtension(url);
            const fileName = `${this.sanitizeFileName(name)}${extension}`;
            const filePath = normalizePath(`${this.config.attachmentFolder}/${fileName}`);
            
            await this.createFolders(this.config.attachmentFolder + '/');
            await vault.createBinary(filePath, arrayBuffer);
            
            return `![[${fileName}]]`;
        } catch (error) {
            console.error(`Failed to download ${type}:`, error);
            return `[${name}](${url})`;
        }
    }

    private createFrontmatter(page: NotionPage): string {
        const frontmatter: Record<string, any> = {
            title: this.getPageTitle(page),
            created: page.created_time,
            updated: page.last_edited_time,
            notion_id: page.id,
            notion_url: page.url
        };

        // Add all properties
        if (page.properties) {
            for (const [key, value] of Object.entries(page.properties)) {
                const propertyValue = this.extractPropertyValue(value);
                if (propertyValue !== null && propertyValue !== undefined) {
                    frontmatter[this.sanitizePropertyName(key)] = propertyValue;
                }
            }
        }

        return '---\n' + this.objectToYaml(frontmatter) + '---\n\n';
    }

    private createDatabasePageFrontmatter(page: NotionPage, database: NotionDatabase): string {
        const frontmatter: Record<string, any> = {
            database: this.getDatabaseTitle(database),
            created: page.created_time,
            updated: page.last_edited_time,
            notion_id: page.id,
            notion_url: page.url
        };

        // Add all database properties
        if (page.properties) {
            for (const [key, value] of Object.entries(page.properties)) {
                const propertyValue = this.extractPropertyValue(value);
                if (propertyValue !== null && propertyValue !== undefined) {
                    frontmatter[this.sanitizePropertyName(key)] = propertyValue;
                }
            }
        }

        return '---\n' + this.objectToYaml(frontmatter) + '---\n\n';
    }

    private createDatabaseOverview(database: NotionDatabase, pages: any[]): string {
        const title = this.getDatabaseTitle(database);
        
        let content = `---\ntitle: ${title}\ntype: database\nnotion_id: ${database.id}\n---\n\n`;
        content += `# ${title}\n\n`;
        content += `> This is a Notion database converted to Obsidian Base format\n\n`;
        content += `**Total entries:** ${pages.length}\n\n`;
        
        // Add property summary
        if (database.properties) {
            content += '## Properties\n\n';
            content += '| Property | Type | Description |\n';
            content += '|----------|------|-------------|\n';
            
            for (const [key, prop] of Object.entries(database.properties)) {
                const type = (prop as any).type;
                const description = this.getPropertyDescription(type);
                content += `| ${key} | ${type} | ${description} |\n`;
            }
            content += '\n';
        }
        
        // Add view configurations (simulate Notion views)
        content += '## Views\n\n';
        content += '- **All Items**: Default table view of all entries\n';
        content += '- **By Status**: Grouped by status property\n';
        content += '- **Recent**: Sorted by last modified date\n\n';
        
        // Add page links
        content += '## Entries\n\n';
        for (const page of pages.slice(0, 50)) { // Limit to first 50 for overview
            const pageTitle = this.getPageTitle(page);
            const fileName = this.sanitizeFileName(pageTitle);
            content += `- [[${fileName}]]\n`;
        }
        
        if (pages.length > 50) {
            content += `\n*... and ${pages.length - 50} more entries*\n`;
        }
        
        return content;
    }

    private getPropertyDescription(type: string): string {
        const descriptions: Record<string, string> = {
            'title': 'Page title',
            'rich_text': 'Text content',
            'number': 'Numeric value',
            'select': 'Single selection',
            'multi_select': 'Multiple selections',
            'date': 'Date/time value',
            'people': 'Person reference',
            'files': 'File attachments',
            'checkbox': 'Boolean value',
            'url': 'Web link',
            'email': 'Email address',
            'phone_number': 'Phone contact',
            'formula': 'Calculated value',
            'relation': 'Linked records',
            'rollup': 'Aggregated data',
            'created_time': 'Creation timestamp',
            'created_by': 'Creator',
            'last_edited_time': 'Last modified',
            'last_edited_by': 'Last editor'
        };
        
        return descriptions[type] || 'Custom property';
    }

    private extractPropertyValue(property: any): any {
        if (!property || !property.type) return null;

        switch (property.type) {
            case 'title':
            case 'rich_text':
                return this.richTextToMarkdown(property[property.type]);
            case 'number':
                return property.number;
            case 'select':
                return property.select?.name;
            case 'multi_select':
                return property.multi_select?.map((s: any) => s.name).join(', ');
            case 'date':
                if (property.date?.end) {
                    return `${property.date.start} to ${property.date.end}`;
                }
                return property.date?.start;
            case 'checkbox':
                return property.checkbox;
            case 'url':
                return property.url;
            case 'email':
                return property.email;
            case 'phone_number':
                return property.phone_number;
            case 'formula':
                const formula = property.formula;
                if (formula?.type === 'string') return formula.string;
                if (formula?.type === 'number') return formula.number;
                if (formula?.type === 'boolean') return formula.boolean;
                if (formula?.type === 'date') return formula.date?.start;
                return null;
            case 'relation':
                return property.relation?.map((r: any) => r.id).join(', ');
            case 'rollup':
                const rollup = property.rollup;
                if (rollup?.type === 'number') return rollup.number;
                if (rollup?.type === 'array') {
                    return rollup.array.map((item: any) => {
                        if (item.type === 'title') return this.richTextToMarkdown(item.title);
                        return item[item.type];
                    }).join(', ');
                }
                return null;
            case 'people':
                return property.people?.map((p: any) => p.name || p.id).join(', ');
            case 'files':
                return property.files?.map((f: any) => f.name).join(', ');
            case 'created_time':
                return property.created_time;
            case 'created_by':
                return property.created_by?.name || property.created_by?.id;
            case 'last_edited_time':
                return property.last_edited_time;
            case 'last_edited_by':
                return property.last_edited_by?.name || property.last_edited_by?.id;
            default:
                return null;
        }
    }

    private getPageTitle(page: any): string {
        if (page.properties) {
            // Try to find any title-type property
            for (const [key, value] of Object.entries(page.properties)) {
                if ((value as any).type === 'title' && (value as any).title) {
                    const title = this.richTextToMarkdown((value as any).title);
                    if (title) return title;
                }
            }
        }
        
        return 'Untitled';
    }

    private getDatabaseTitle(database: any): string {
        if (database.title && Array.isArray(database.title)) {
            return this.richTextToMarkdown(database.title);
        }
        return 'Untitled Database';
    }

    private sanitizeFileName(name: string): string {
        // Remove/replace invalid characters for file names
        return name
            .replace(/[\\/:*?"<>|]/g, '-')
            .replace(/\s+/g, ' ')
            .replace(/^\.+/, '') // Remove leading dots
            .trim()
            .substring(0, 255); // Limit length
    }

    private sanitizePropertyName(name: string): string {
        // Convert to valid YAML key
        return name
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '');
    }

    private objectToYaml(obj: any, indent = 0): string {
        let yaml = '';
        const spaces = ' '.repeat(indent);
        
        for (const [key, value] of Object.entries(obj)) {
            if (value === null || value === undefined) continue;
            
            yaml += `${spaces}${key}: `;
            
            if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
                yaml += '\n' + this.objectToYaml(value, indent + 2);
            } else if (Array.isArray(value)) {
                if (value.length === 0) {
                    yaml += '[]\n';
                } else {
                    yaml += '\n';
                    for (const item of value) {
                        yaml += `${spaces}  - ${item}\n`;
                    }
                }
            } else if (typeof value === 'string' && value.includes('\n')) {
                yaml += `|\n`;
                value.split('\n').forEach(line => {
                    yaml += `${spaces}  ${line}\n`;
                });
            } else if (typeof value === 'string' && (value.includes(':') || value.includes('#') || value.includes('"'))) {
                yaml += `"${value.replace(/"/g, '\\"')}"\n`;
            } else {
                yaml += `${value}\n`;
            }
        }
        
        return yaml;
    }

    private getFileExtension(url: string): string {
        const match = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i);
        return match ? `.${match[1]}` : '.bin';
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}