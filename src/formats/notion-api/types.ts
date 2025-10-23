/**
 * Type definitions for Notion API importer
 */

export interface ProcessedPage {
	id: string;
	title: string;
	folderPath: string;
	properties: Record<string, any>;
}

export interface NotionImporterConfig {
	maxRetries: number;
	requestCount: number;
}

