/**
 * Notion Database to Obsidian Base Converter
 * Handles conversion of Notion databases to Obsidian Bases
 */

import { Vault } from 'obsidian';
import { NotionAPIClient, NotionDatabase, NotionDataSource, NotionPage } from './client';
import { NotionBlockConverter } from './block-converter';

export interface ObsidianBaseProperty {
	name: string;
	type: 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'multi_select' | 'url' | 'email' | 'phone' | 'file' | 'relation';
	options?: string[]; // For select/multi_select
}

export class NotionDatabaseConverter {
	private blockConverter: NotionBlockConverter | null = null;

	async convertToBase(
		database: NotionDatabase,
		dataSource: NotionDataSource,
		pages: NotionPage[],
		basePath: string,
		vault: Vault,
		apiClient: NotionAPIClient
	): Promise<void> {
		// Initialize block converter if not already done
		if (!this.blockConverter) {
			this.blockConverter = new NotionBlockConverter(
				vault.getConfig('attachmentFolderPath') ?? '',
				false // Use default line breaks for database content
			);
		}

		// Create the base configuration
		const baseConfig = this.createBaseConfig(database, dataSource);
		
		// Create base.json file
		const baseConfigPath = `${basePath}/base.json`;
		await vault.create(baseConfigPath, JSON.stringify(baseConfig, null, 2));

		// Convert each page to a markdown file
		for (const page of pages) {
			await this.convertPageToMarkdown(page, basePath, vault, apiClient, dataSource);
		}

		// Create views if the database has any
		await this.createViews(database, dataSource, basePath, vault);
	}

	private createBaseConfig(database: NotionDatabase, dataSource: NotionDataSource): any {
		const properties = this.convertProperties(dataSource.properties);
		
		return {
			name: this.getDatabaseTitle(database),
			description: this.getDatabaseDescription(database),
			properties,
			created: database.created_time,
			modified: database.last_edited_time,
			source: 'notion-api-import',
			notion_database_id: database.id,
			notion_data_source_id: dataSource.id
		};
	}

	private convertProperties(notionProperties: Record<string, any>): ObsidianBaseProperty[] {
		const properties: ObsidianBaseProperty[] = [];

		for (const [name, property] of Object.entries(notionProperties)) {
			const obsidianProperty = this.convertProperty(name, property);
			if (obsidianProperty) {
				properties.push(obsidianProperty);
			}
		}

		return properties;
	}

	private convertProperty(name: string, notionProperty: any): ObsidianBaseProperty | null {
		const type = notionProperty.type;

		switch (type) {
			case 'title':
			case 'rich_text':
				return {
					name,
					type: 'text'
				};

			case 'number':
				return {
					name,
					type: 'number'
				};

			case 'select':
				return {
					name,
					type: 'select',
					options: notionProperty.select?.options?.map((opt: any) => opt.name) || []
				};

			case 'multi_select':
				return {
					name,
					type: 'multi_select',
					options: notionProperty.multi_select?.options?.map((opt: any) => opt.name) || []
				};

			case 'date':
				return {
					name,
					type: 'date'
				};

			case 'checkbox':
				return {
					name,
					type: 'checkbox'
				};

			case 'url':
				return {
					name,
					type: 'url'
				};

			case 'email':
				return {
					name,
					type: 'email'
				};

			case 'phone_number':
				return {
					name,
					type: 'phone'
				};

			case 'files':
				return {
					name,
					type: 'file'
				};

			case 'relation':
				return {
					name,
					type: 'relation'
				};

			case 'people':
			case 'created_by':
			case 'last_edited_by':
				// Convert to text for now
				return {
					name,
					type: 'text'
				};

			case 'created_time':
			case 'last_edited_time':
				return {
					name,
					type: 'date'
				};

			case 'formula':
			case 'rollup':
				// Convert to text for now
				return {
					name,
					type: 'text'
				};

			default:
				console.warn(`Unsupported property type: ${type}`);
				return {
					name,
					type: 'text'
				};
		}
	}

	private async convertPageToMarkdown(
		page: NotionPage,
		basePath: string,
		vault: Vault,
		apiClient: NotionAPIClient,
		dataSource: NotionDataSource
	): Promise<void> {
		if (!this.blockConverter) {
			throw new Error('Block converter not initialized');
		}

		// Get page content
		const blocks = await apiClient.getPageBlocks(page.id);
		const content = await this.blockConverter.convertBlocksToMarkdown(blocks, apiClient);

		// Create frontmatter from page properties
		const frontmatter = this.createFrontmatter(page, dataSource);
		
		// Get page title
		const title = this.getPageTitle(page);
		
		// Combine frontmatter and content
		const markdown = frontmatter + '\n\n' + content;
		
		// Create the file
		const filename = this.sanitizeFileName(title) + '.md';
		const filePath = `${basePath}/${filename}`;
		
		await vault.create(filePath, markdown);
	}

	private createFrontmatter(page: NotionPage, dataSource: NotionDataSource): string {
		const frontmatterObj: Record<string, any> = {};

		// Add basic metadata
		frontmatterObj.id = page.id;
		frontmatterObj.created = page.created_time;
		frontmatterObj.modified = page.last_edited_time;
		frontmatterObj.archived = page.archived;

		// Convert page properties
		for (const [propertyName, propertyValue] of Object.entries(page.properties)) {
			const dataSourceProperty = dataSource.properties[propertyName];
			if (!dataSourceProperty) continue;

			const convertedValue = this.convertPropertyValue(propertyValue, dataSourceProperty.type);
			if (convertedValue !== null && convertedValue !== undefined) {
				frontmatterObj[propertyName] = convertedValue;
			}
		}

		// Convert to YAML
		const yamlLines = ['---'];
		for (const [key, value] of Object.entries(frontmatterObj)) {
			if (Array.isArray(value)) {
				yamlLines.push(`${key}:`);
				for (const item of value) {
					yamlLines.push(`  - ${this.escapeYamlValue(item)}`);
				}
			} else {
				yamlLines.push(`${key}: ${this.escapeYamlValue(value)}`);
			}
		}
		yamlLines.push('---');

		return yamlLines.join('\n');
	}

	private convertPropertyValue(propertyValue: any, propertyType: string): any {
		if (!propertyValue) return null;

		switch (propertyType) {
			case 'title':
				return propertyValue.title?.[0]?.plain_text || null;

			case 'rich_text':
				return propertyValue.rich_text?.map((rt: any) => rt.plain_text).join('') || null;

			case 'number':
				return propertyValue.number;

			case 'select':
				return propertyValue.select?.name || null;

			case 'multi_select':
				return propertyValue.multi_select?.map((opt: any) => opt.name) || [];

			case 'date':
				if (propertyValue.date?.start) {
					if (propertyValue.date.end) {
						return `${propertyValue.date.start} to ${propertyValue.date.end}`;
					}
					return propertyValue.date.start;
				}
				return null;

			case 'checkbox':
				return propertyValue.checkbox;

			case 'url':
				return propertyValue.url;

			case 'email':
				return propertyValue.email;

			case 'phone_number':
				return propertyValue.phone_number;

			case 'files':
				return propertyValue.files?.map((file: any) => {
					if (file.type === 'external') {
						return file.external?.url;
					} else if (file.type === 'file') {
						return file.file?.url;
					}
					return null;
				}).filter(Boolean) || [];

			case 'people':
			case 'created_by':
			case 'last_edited_by':
				return propertyValue.people?.map((person: any) => person.name || person.id).join(', ') ||
					   propertyValue.created_by?.name || propertyValue.created_by?.id ||
					   propertyValue.last_edited_by?.name || propertyValue.last_edited_by?.id ||
					   null;

			case 'created_time':
			case 'last_edited_time':
				return propertyValue.created_time || propertyValue.last_edited_time;

			case 'formula':
				// Return the computed value based on formula type
				if (propertyValue.formula?.type === 'string') {
					return propertyValue.formula.string;
				} else if (propertyValue.formula?.type === 'number') {
					return propertyValue.formula.number;
				} else if (propertyValue.formula?.type === 'boolean') {
					return propertyValue.formula.boolean;
				} else if (propertyValue.formula?.type === 'date') {
					return propertyValue.formula.date?.start;
				}
				return null;

			case 'rollup':
				// Return the rollup value based on rollup type
				if (propertyValue.rollup?.type === 'number') {
					return propertyValue.rollup.number;
				} else if (propertyValue.rollup?.type === 'array') {
					return propertyValue.rollup.array?.map((item: any) => {
						// Recursively convert array items
						return this.convertPropertyValue(item, 'rich_text'); // Assume text for simplicity
					}).filter(Boolean);
				}
				return null;

			case 'relation':
				return propertyValue.relation?.map((rel: any) => rel.id) || [];

			default:
				console.warn(`Unsupported property type for conversion: ${propertyType}`);
				return null;
		}
	}

	private async createViews(
		database: NotionDatabase,
		dataSource: NotionDataSource,
		basePath: string,
		vault: Vault
	): Promise<void> {
		// For now, create a simple default view
		// In the future, this could be enhanced to support Notion's actual views
		const defaultView = {
			name: 'All Items',
			type: 'table',
			filter: {},
			sort: [],
			properties: Object.keys(dataSource.properties)
		};

		const viewsPath = `${basePath}/views`;
		await vault.createFolder(viewsPath);
		
		const viewPath = `${viewsPath}/all-items.json`;
		await vault.create(viewPath, JSON.stringify(defaultView, null, 2));
	}

	private getDatabaseTitle(database: NotionDatabase): string {
		return database.title?.[0]?.plain_text || `Untitled Database ${database.id.slice(0, 8)}`;
	}

	private getDatabaseDescription(database: NotionDatabase): string {
		return database.description?.map(desc => desc.plain_text).join('') || '';
	}

	private getPageTitle(page: NotionPage): string {
		// Try different property names that might contain the title
		const titleProperties = ['title', 'Title', 'Name', 'name'];
		
		for (const propName of titleProperties) {
			const property = page.properties[propName];
			if (property) {
				if (property.title?.[0]?.plain_text) {
					return property.title[0].plain_text;
				}
				if (property.rich_text?.[0]?.plain_text) {
					return property.rich_text[0].plain_text;
				}
			}
		}

		return `Untitled Page ${page.id.slice(0, 8)}`;
	}

	private sanitizeFileName(name: string): string {
		return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
	}

	private escapeYamlValue(value: any): string {
		if (typeof value === 'string') {
			// Escape special YAML characters
			if (value.includes(':') || value.includes('#') || value.includes('"') || value.includes("'")) {
				return `"${value.replace(/"/g, '\\"')}"`;
			}
			return value;
		}
		return String(value);
	}
}