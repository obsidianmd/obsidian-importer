import { TFolder, TFile } from 'obsidian';

/**
 * Sort configuration for a view.
 */
export interface BaseSortConfig {
	/** Property to sort by (e.g., 'file.name', 'status', 'note.date') */
	property: string;
	/** Sort direction */
	direction: 'ASC' | 'DESC';
}

/**
 * Group by configuration for a view.
 */
export interface BaseGroupByConfig {
	/** Property to group by */
	property: string;
	/** Sort direction for groups */
	direction: 'ASC' | 'DESC';
}

/**
 * Represents a view in a Base file.
 */
export interface BaseView {
	/** Type of view (table, cards, list, etc.) */
	type: string;
	/** Name of the view */
	name: string;
	/** Optional: View-specific filters (same format as top-level filters) */
	filters?: string[];
	/** Optional: Filter logic for view-specific filters */
	filterLogic?: 'and' | 'or';
	/** Optional: Column order for table views */
	order?: string[];
	/** Optional: Sort configuration */
	sort?: BaseSortConfig[];
	/** Optional: Group by configuration */
	groupBy?: BaseGroupByConfig;
	/** Optional: Limit number of results */
	limit?: number;
	/** Optional: Summaries mapping property to summary key (e.g., {'price': 'sum', 'quantity': 'average'}) */
	summaries?: Record<string, string>;
	/** Optional: Additional view-specific data */
	data?: Record<string, any>;
}

/**
 * Property display configuration.
 */
export interface BasePropertyConfig {
	/** Display name for the property */
	displayName: string;
}

/**
 * Options for generating a Base file.
 */
export interface BaseOptions {
	/** Optional: Filter expressions (e.g., ['file.folder == "Import"', 'file.tags.contains("#todo")']) */
	filters?: string[];
	/** Optional: Filter logic - 'and' or 'or' (defaults to 'and') */
	filterLogic?: 'and' | 'or';
	/** Optional: Formula definitions (e.g., {'full_name': 'firstName + " " + lastName'}) */
	formulas?: Record<string, string>;
	/** Optional: Property configurations (e.g., {'status': {displayName: 'Status'}}) */
	properties?: Record<string, BasePropertyConfig>;
	/** Optional: Summary formula definitions (e.g., {'total': 'sum(price)'}) */
	summaries?: Record<string, string>;
	/** Views to include in the Base file */
	views: BaseView[];
	/** Optional: Folder path for new items created from this base */
	newItemFolder?: string;
	/** Optional: Template file path for new items */
	newItemTemplate?: string;
}

/**
 * Generates the content for an Obsidian Base file.
 * 
 * @param options - Configuration for the Base file
 * @returns Base file content in YAML format
 * 
 * @example
 * ```ts
 * const content = generateBaseContent({
 *   filters: ['file.folder == "CSV import"'],
 *   formulas: { full_name: 'firstName + " " + lastName' },
 *   properties: { status: { displayName: 'Status' } },
 *   views: [{
 *     type: 'table',
 *     name: 'Table',
 *     order: ['file.name', 'title', 'date', 'category'],
 *     sort: [{ property: 'file.name', direction: 'ASC' }]
 *   }]
 * });
 * ```
 */
export function generateBaseContent(options: BaseOptions): string {
	const { 
		filters, 
		filterLogic = 'and', 
		formulas,
		properties,
		summaries,
		views,
		newItemFolder,
		newItemTemplate
	} = options;
	
	const lines: string[] = [];
	
	// Add filter section if filters are provided
	if (filters && filters.length > 0) {
		lines.push('filters:');
		lines.push(`  ${filterLogic}:`);
		for (const filter of filters) {
			lines.push(`    - ${filter}`);
		}
	}
	
	// Add formulas section
	if (formulas && Object.keys(formulas).length > 0) {
		if (lines.length > 0) lines.push('');
		lines.push('formulas:');
		for (const [name, formula] of Object.entries(formulas)) {
			// Properly quote formulas to handle special characters
			const quotedFormula = formula.includes('\'') 
				? `"${formula.replace(/"/g, '\\"')}"` 
				: `'${formula}'`;
			lines.push(`  ${name}: ${quotedFormula}`);
		}
	}
	
	// Add properties section
	if (properties && Object.keys(properties).length > 0) {
		if (lines.length > 0) lines.push('');
		lines.push('properties:');
		for (const [propName, config] of Object.entries(properties)) {
			lines.push(`  ${propName}:`);
			if (config.displayName) {
				lines.push(`    displayName: ${config.displayName}`);
			}
		}
	}
	
	// Add summaries section (top-level summary formulas)
	if (summaries && Object.keys(summaries).length > 0) {
		if (lines.length > 0) lines.push('');
		lines.push('summaries:');
		for (const [name, formula] of Object.entries(summaries)) {
			const quotedFormula = formula.includes('\'') 
				? `"${formula.replace(/"/g, '\\"')}"` 
				: `'${formula}'`;
			lines.push(`  ${name}: ${quotedFormula}`);
		}
	}
	
	// Add new item configuration
	if (newItemFolder) {
		if (lines.length > 0) lines.push('');
		lines.push(`newItemFolder: "${newItemFolder}"`);
	}
	if (newItemTemplate) {
		if (lines.length > 0 && !newItemFolder) lines.push('');
		lines.push(`newItemTemplate: "${newItemTemplate}"`);
	}
	
	// Add views section
	if (views.length > 0) {
		if (lines.length > 0) lines.push('');
		lines.push('views:');
		for (const view of views) {
			lines.push(`  - type: ${view.type}`);
			lines.push(`    name: ${view.name}`);
			
			// Add view-specific filters
			if (view.filters && view.filters.length > 0) {
				const viewFilterLogic = view.filterLogic || 'and';
				lines.push('    filters:');
				lines.push(`      ${viewFilterLogic}:`);
				for (const filter of view.filters) {
					lines.push(`        - ${filter}`);
				}
			}
			
			// Add limit
			if (view.limit !== undefined && view.limit > 0) {
				lines.push(`    limit: ${view.limit}`);
			}
			
			// Add groupBy
			if (view.groupBy) {
				lines.push('    groupBy:');
				lines.push(`      property: ${view.groupBy.property}`);
				lines.push(`      direction: ${view.groupBy.direction}`);
			}
			
			// Add order
			if (view.order && view.order.length > 0) {
				lines.push('    order:');
				for (const column of view.order) {
					lines.push(`      - ${column}`);
				}
			}
			
			// Add sort
			if (view.sort && view.sort.length > 0) {
				lines.push('    sort:');
				for (const sortConfig of view.sort) {
					lines.push(`      - property: ${sortConfig.property}`);
					lines.push(`        direction: ${sortConfig.direction}`);
				}
			}
			
			// Add view summaries
			if (view.summaries && Object.keys(view.summaries).length > 0) {
				lines.push('    summaries:');
				for (const [propName, summaryKey] of Object.entries(view.summaries)) {
					lines.push(`      ${propName}: ${summaryKey}`);
				}
			}
			
			// Add any additional view data
			if (view.data) {
				for (const [key, value] of Object.entries(view.data)) {
					if (typeof value === 'string') {
						lines.push(`    ${key}: ${value}`);
					}
					else if (typeof value === 'number' || typeof value === 'boolean') {
						lines.push(`    ${key}: ${value}`);
					}
					else if (typeof value === 'object') {
						lines.push(`    ${key}:`);
						// Simple nested object handling
						for (const [nestedKey, nestedValue] of Object.entries(value)) {
							lines.push(`      ${nestedKey}: ${nestedValue}`);
						}
					}
				}
			}
		}
	}
	
	return lines.join('\n');
}

/**
 * Creates a Base file in the specified folder.
 * 
 * @param folder - The folder to create the Base file in
 * @param fileName - Name of the Base file (without .base extension)
 * @param options - Configuration for the Base file content
 * @param vault - Obsidian vault instance
 * @returns The created TFile
 * 
 * @example
 * ```ts
 * await createBaseFile(folder, 'CSV import', {
 *   filters: ['file.folder == "CSV import"'],
 *   views: [{
 *     type: 'table',
 *     name: 'Table',
 *     order: ['file.name', 'title', 'date', 'category']
 *   }]
 * }, this.app.vault);
 * ```
 */
export async function createBaseFile(
	folder: TFolder,
	fileName: string,
	options: BaseOptions,
	vault: any
): Promise<TFile> {
	const content = generateBaseContent(options);
	const filePath = `${folder.path}/${fileName}.base`;
	
	// Check if file already exists
	const existingFile = vault.getAbstractFileByPath(filePath);
	if (existingFile instanceof TFile) {
		// Update existing file
		await vault.modify(existingFile, content);
		return existingFile;
	}
	
	// Create new file
	return await vault.create(filePath, content);
}

