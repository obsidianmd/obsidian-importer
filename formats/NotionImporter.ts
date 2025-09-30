import type { FormatImporter } from './FormatImporter';
import { Platform, filesystem } from '../src/filesystem';
import { getPage, getDatabase, downloadFile } from '../src/notion';
import * as path from '../src/path';
import yaml from 'js-yaml';

/**
 * NotionImporter
 * -----------------------
 * Converts Notion pages/databases to Obsidian Markdown and .base YAML
 * Supports attachments, Kanban, and Calendar fallback
 */
export class NotionImporter implements FormatImporter {
  name = 'Notion';
  description = 'Import Notion pages and databases via API';
  modal: any;
  settings = { attachmentFolder: 'attachments' };

  constructor(modal?: any) { this.modal = modal; }

  /** Render settings UI */
  async renderSettings() {
    if (!this.modal) return;
    const container = this.modal.contentEl;
    const folderInput = container.createEl('input', { type: 'text', placeholder: 'Attachment Folder' });
    folderInput.value = this.settings.attachmentFolder;
    folderInput.oninput = (e: any) => this.settings.attachmentFolder = e.target.value;
  }

  /** Import a Notion page as Markdown */
  async importPage(pageId: string, outputFolder: string): Promise<void> {
    const page = await getPage(pageId);
    const markdown = await this.convertPageToMarkdown(page);
    this.writeFile(outputFolder, page.properties.title.title[0].plain_text, markdown, 'md');
  }

  /** Import a Notion database as .base YAML (with optional view fallback) */
  async importDatabase(databaseId: string, outputFolder: string, viewType?: 'kanban' | 'calendar', viewConfig?: any): Promise<void> {
    const records = await getDatabase(databaseId);
    const content = viewType
      ? this.convertDatabaseFallbackBase('Database', records, viewType, viewConfig)
      : this.convertDatabaseToBase('Database', records);
    this.writeFile(outputFolder, 'Database', content, 'base');
  }

  /** ------------------------------
   * Page → Markdown conversion
   * ---------------------------- */
  private async convertPageToMarkdown(notionPage: any): Promise<string> {
    let markdown = `# ${notionPage.properties.title.title[0].plain_text}\n\n`;
    if (notionPage.children) {
      for (const block of notionPage.children) markdown += await this.convertBlock(block);
    }
    return markdown;
  }

  /** Recursive block conversion */
  private async convertBlock(block: any): Promise<string> {
    let markdown = '';
    const getText = (richText: any[]) => richText.map(t => t.plain_text).join('');

    switch (block.type) {
      case 'paragraph': markdown += getText(block.paragraph.rich_text) + '\n\n'; break;
      case 'heading_1': markdown += `# ${getText(block.heading_1.rich_text)}\n\n`; break;
      case 'heading_2': markdown += `## ${getText(block.heading_2.rich_text)}\n\n`; break;
      case 'heading_3': markdown += `### ${getText(block.heading_3.rich_text)}\n\n`; break;
      case 'to_do': markdown += `- [${block.to_do.checked ? 'x' : ' '}] ${getText(block.to_do.rich_text)}\n`; break;
      case 'bulleted_list_item': markdown += `- ${getText(block.bulleted_list_item.rich_text)}\n`; break;
      case 'numbered_list_item': markdown += `1. ${getText(block.numbered_list_item.rich_text)}\n`; break;
      case 'image':
        const fileName = path.basename(block.image.file.url);
        await this.saveAttachment(block.image.file.url, fileName);
        markdown += `![](${this.settings.attachmentFolder}/${fileName})\n\n`; break;
      case 'table':
        (block.table.table_rows || []).forEach((row: any) => {
          markdown += `| ${(row.cells.map((c: any) => getText(c)).join(' | '))} |\n`;
        });
        markdown += '\n'; break;
      case 'divider': markdown += '---\n\n'; break;
      default: markdown += `<!-- Unsupported block type: ${block.type} -->\n\n`; break;
    }

    if (block.has_children && block.children) {
      for (const child of block.children) markdown += await this.convertBlock(child);
    }
    return markdown;
  }

  /** ------------------------------
   * Database → .base conversion
   * ---------------------------- */
  private convertDatabaseToBase(name: string, records: any[]): string {
    const base = { name, columns: [], entries: records.map(r => this.mapRecordProperties(r.properties)) };
    return yaml.dump(base);
  }

  private convertDatabaseFallbackBase(name: string, records: any[], viewType: 'kanban' | 'calendar', viewConfig: any): string {
    const base: any = { name, columns: [], entries: [] };

    if (viewType === 'kanban') (viewConfig.columns || []).forEach(col => base.columns.push({ name: col.name, type: 'kanban' }));
    else if (viewType === 'calendar') base.columns.push({ name: viewConfig.dateProperty || 'Date', type: 'date' });

    records.forEach(r => base.entries.push(this.mapRecordProperties(r.properties, viewType)));
    return yaml.dump(base);
  }

  /** Map Notion record properties to .base entry */
  private mapRecordProperties(properties: any, viewType?: string) {
    const entry: any = {};
    for (const key in properties) {
      const prop = properties[key];
      entry[key] = prop.title?.[0]?.plain_text
        || prop.checkbox
        || prop.number
        || prop.rich_text?.[0]?.plain_text
        || prop.select?.name
        || prop.multi_select?.map((s: any) => s.name).join(', ')
        || prop.date?.start
        || null;
    }
    return entry;
  }

  /** ------------------------------
   * File operations
   * ---------------------------- */
  private async saveAttachment(url: string, fileName: string) {
    if (!filesystem.exists(this.settings.attachmentFolder)) filesystem.mkdir(this.settings.attachmentFolder, { recursive: true });
    await downloadFile(url, path.join(this.settings.attachmentFolder, fileName));
  }

  private writeFile(folder: string, fileName: string, content: string, ext: 'md' | 'base') {
    if (!filesystem.exists(folder)) filesystem.mkdir(folder, { recursive: true });
    filesystem.writeFileSync(path.join(folder, `${fileName}.${ext}`), content, 'utf8');
  }
}

