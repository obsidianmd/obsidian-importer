/**
 * Type definitions for Notion API Importer
 *
 * Shared interfaces and types used across the importer modules
 * Extracted from the main notion-api.ts for better code organization
 *
 * @author Notion API Importer Team
 * @version 1.0.0
 * @license MIT
 */

export interface NotionImporterSettings {
	notionApiKey: string;
	defaultOutputFolder: string;
	importImages: boolean;
	preserveNotionBlocks: boolean;
	convertToMarkdown: boolean;
	includeMetadata: boolean;
}

export interface NotionPage {
	id: string;
	title: string;
	url: string;
	lastEditedTime: string;
	createdTime: string;
	properties: Record<string, any>;
	parent: any;
	icon?: {
		type: string;
		emoji?: string;
		file?: any;
		external?: any;
	};
	cover?: {
		type: string;
		file?: any;
		external?: any;
	};
}

export interface NotionDatabase {
	id: string;
	title: string;
	description: string;
	properties: Record<string, any>;
	url: string;
	lastEditedTime: string;
	createdTime: string;
}

export interface NotionBlock {
	id: string;
	type: string;
	created_time: string;
	last_edited_time: string;
	archived: boolean;
	has_children: boolean;
	parent: any;
	[key: string]: any; // For type-specific properties
}

export interface ProcessedContent {
	markdown: string;
	frontmatter: Record<string, any>;
	attachments: string[];
	images: string[];
}

export interface ConversionContext {
	basePath: string;
	settings: NotionImporterSettings;
	client: any;
	processedBlocks: Set<string>;
	vault?: any; // Optional Obsidian Vault API
}