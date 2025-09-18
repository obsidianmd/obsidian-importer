import { NotionDatabase, NotionDataSource } from './notion-client';

export class BaseGenerator {
	generateBase(database: NotionDatabase, dataSources: NotionDataSource[]): string {
		const properties = this.convertProperties(database.properties);
		const views = this.generateViews(database, dataSources);

		return `---
type: base
name: ${database.title}
description: Imported from Notion database
properties:
${properties}
views:
${views}
---`;
	}

	private convertProperties(notionProperties: Record<string, any>): string {
		const properties: string[] = [];

		for (const [key, value] of Object.entries(notionProperties)) {
			const property = this.convertProperty(key, value);
			if (property) {
				properties.push(property);
			}
		}

		return properties.join('\n');
	}

	private convertProperty(name: string, notionProperty: any): string {
		const sanitizedName = this.sanitizePropertyName(name);
		const type = this.mapNotionTypeToObsidian(notionProperty.type);

		if (!type) {
			return ''; // Skip unsupported property types
		}

		let property = `  ${sanitizedName}:\n    type: ${type}`;

		// Add type-specific configuration
		switch (notionProperty.type) {
			case 'select':
				if (notionProperty.select?.options) {
					const options = notionProperty.select.options
						.map((opt: any) => `"${opt.name}"`)
						.join(', ');
					property += `\n    options: [${options}]`;
				}
				break;
			
			case 'multi_select':
				if (notionProperty.multi_select?.options) {
					const options = notionProperty.multi_select.options
						.map((opt: any) => `"${opt.name}"`)
						.join(', ');
					property += `\n    options: [${options}]`;
				}
				break;
			
			case 'number':
				if (notionProperty.number?.format) {
					property += `\n    format: ${notionProperty.number.format}`;
				}
				break;
			
			case 'date':
				if (notionProperty.date?.include_time) {
					property += `\n    include_time: ${notionProperty.date.include_time}`;
				}
				break;
		}

		return property;
	}

	private mapNotionTypeToObsidian(notionType: string): string | null {
		const typeMap: Record<string, string> = {
			'title': 'text',
			'rich_text': 'text',
			'number': 'number',
			'select': 'select',
			'multi_select': 'multi_select',
			'date': 'date',
			'people': 'text', // Map to text for now
			'files': 'text', // Map to text for now
			'checkbox': 'checkbox',
			'url': 'url',
			'email': 'text',
			'phone_number': 'text',
			'formula': 'text', // Map formulas to text
			'relation': 'text', // Map relations to text for now
			'rollup': 'text', // Map rollups to text for now
			'created_time': 'date',
			'created_by': 'text',
			'last_edited_time': 'date',
			'last_edited_by': 'text'
		};

		return typeMap[notionType] || null;
	}

	private generateViews(database: NotionDatabase, dataSources: NotionDataSource[]): string {
		const views: string[] = [];

		// Generate a default table view
		views.push(this.generateTableView(database));

		// Generate additional views based on data sources
		for (const dataSource of dataSources) {
			views.push(this.generateDataSourceView(dataSource));
		}

		return views.join('\n');
	}

	private generateTableView(database: NotionDatabase): string {
		const properties = Object.keys(database.properties);
		const visibleProperties = properties.slice(0, 5); // Show first 5 properties

		return `  - name: Table View
    type: table
    properties:
${visibleProperties.map(prop => `      - ${this.sanitizePropertyName(prop)}`).join('\n')}`;
	}

	private generateDataSourceView(dataSource: NotionDataSource): string {
		return `  - name: ${dataSource.name} View
    type: table
    properties:
      - title
      - created_time
      - last_edited_time`;
	}

	private sanitizePropertyName(name: string): string {
		return name
			.toLowerCase()
			.replace(/[^a-z0-9_]/g, '_')
			.replace(/_{2,}/g, '_')
			.replace(/^_|_$/g, '');
	}
}
