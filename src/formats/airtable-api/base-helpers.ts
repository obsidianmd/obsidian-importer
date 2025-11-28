/**
 * Base file generation for Airtable tables
 */

import { normalizePath } from 'obsidian';
import { stringifyYaml } from 'obsidian';
import type { CreateBaseFileParams } from './types';
import { sanitizeFileName } from '../../util';

/**
 * Create a .base file for an Airtable table
 */
export async function createBaseFile(params: CreateBaseFileParams): Promise<void> {
	const { vault, tableName, tableFolderPath } = params;
	
	// Generate base file name
	const sanitizedTableName = sanitizeFileName(tableName);
	const baseFileName = `${sanitizedTableName}.base`;
	
	// Get parent folder
	const parentPath = tableFolderPath.split('/').slice(0, -1).join('/');
	const baseFilePath = parentPath ? `${parentPath}/${baseFileName}` : baseFileName;
	
	// Generate content
	const content = generateBaseFileContent(params);
	
	// Create the file
	try {
		await vault.create(normalizePath(baseFilePath), content);
	}
	catch (error) {
		console.error(`Failed to create base file: ${baseFilePath}`, error);
		// Don't fail the entire import if base file creation fails
	}
}

/**
 * Generate content for a .base file
 */
function generateBaseFileContent(params: CreateBaseFileParams): string {
	const { tableFolderPath, fields, views } = params;
	
	// Build property columns for the base file
	const propertyColumns: string[] = ['file.name'];
	
	// Add all fields as columns
	for (const field of fields) {
		const propertyName = sanitizePropertyName(field.name);
		propertyColumns.push(propertyName);
	}
	
	// Build base config
	const baseConfig: any = {
		// Filter to show only files in this table's folder
		filters: `file.folder == "${tableFolderPath}"`,
		views: [],
	};
	
	// Add default table view
	baseConfig.views.push({
		type: 'table',
		name: 'All Records',
		order: propertyColumns,
	});
	
	// Add views from Airtable
	for (const view of views) {
		const viewName = view.name || 'Untitled View';
		
		// Map Airtable view type to Obsidian view type
		let obsidianViewType = 'table';
		switch (view.type.toLowerCase()) {
			case 'grid':
				obsidianViewType = 'table';
				break;
			case 'form':
			case 'kanban':
			case 'gallery':
			case 'calendar':
				// Obsidian doesn't support these view types yet
				// Fall back to table view
				obsidianViewType = 'table';
				break;
			default:
				obsidianViewType = 'table';
		}
		
		baseConfig.views.push({
			type: obsidianViewType,
			name: viewName,
			order: propertyColumns,
		});
	}
	
	// Convert to YAML
	return stringifyYaml(baseConfig);
}

/**
 * Sanitize property name for use in base file
 */
function sanitizePropertyName(name: string): string {
	// Remove special characters, keep alphanumeric, spaces, hyphens, underscores
	return name.replace(/[^\w\s-]/g, '').trim();
}

/**
 * Convert Airtable field type to Obsidian property type
 */
export function mapFieldTypeToObsidianType(fieldType: string): string {
	switch (fieldType) {
		case 'singleLineText':
		case 'multilineText':
		case 'richText':
		case 'email':
		case 'url':
		case 'phoneNumber':
			return 'text';
		
		case 'number':
		case 'currency':
		case 'percent':
		case 'duration':
		case 'rating':
		case 'autoNumber':
		case 'count':
			return 'number';
		
		case 'singleSelect':
			return 'text';
		
		case 'multipleSelects':
			return 'multitext';
		
		case 'date':
			return 'date';
		
		case 'dateTime':
		case 'createdTime':
		case 'lastModifiedTime':
			return 'datetime';
		
		case 'checkbox':
			return 'checkbox';
		
		case 'multipleRecordLinks':
			return 'multitext'; // Will be converted to wiki links
		
		case 'multipleAttachments':
			return 'multitext';
		
		case 'singleCollaborator':
		case 'createdBy':
		case 'lastModifiedBy':
			return 'text';
		
		case 'multipleCollaborators':
			return 'multitext';
		
		case 'formula':
		case 'rollup':
		case 'lookup':
			return 'text'; // Default to text for computed fields
		
		default:
			return 'text';
	}
}

