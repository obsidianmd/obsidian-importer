import type { DataSourceViewObjectResponse } from '@notionhq/client';
import type { BasesConfigFileView } from 'obsidian';
import type { NotionProperties } from './types';

type BoardConfig = Extract<NonNullable<DataSourceViewObjectResponse['configuration']>, { type: 'board' }>;

/** The kanban settings that the 1.13 typings don't have yet. */
export interface KanbanView extends BasesConfigFileView {
	groupOrder?: (string | null)[];
	image?: string;
	imageFit?: 'contain';
}

/**
 * A Bases kanban view for each Notion board.
 *
 * `keyById` maps a Notion property ID to its column in the base, such as
 * `Status` or `formula.State`. A board grouped by a property that has no
 * column is skipped, because a kanban without its group is a single pile.
 *
 * Notion's board filters, sorts and sub-groups are not carried over.
 */
export function kanbanViews(
	views: DataSourceViewObjectResponse[],
	properties: NotionProperties,
	keyById: ReadonlyMap<string, string>,
	coverPropertyName: string
): KanbanView[] {
	const result: KanbanView[] = [];

	for (const view of views) {
		const config = view.configuration;
		if (view.type !== 'board' || config?.type !== 'board') continue;

		const groupKey = keyById.get(config.group_by.property_id);
		if (!groupKey) continue;

		const groupBy = config.group_by;
		// A formula board keeps its sort with the formula's result type.
		const sort = groupBy.type === 'formula' ? groupBy.group_by.sort : groupBy.sort;

		const kanban: KanbanView = {
			type: 'kanban',
			name: view.name,
			groupBy: {
				property: propertyId(groupKey),
				direction: sort.type === 'descending' ? 'DESC' : 'ASC',
			},
		};

		if (sort.type === 'manual') {
			const order = optionOrder(groupBy, properties);
			if (order) kanban.groupOrder = order;
		}

		kanban.order = cardProperties(config, keyById);

		const image = coverProperty(config, keyById, coverPropertyName);
		if (image) {
			kanban.image = image;
			if (config.cover_aspect === 'contain') kanban.imageFit = 'contain';
		}

		result.push(kanban);
	}

	return result;
}

function propertyId(key: string): string {
	return key.startsWith('formula.') || key.startsWith('file.') ? key : `note.${key}`;
}

/**
 * The columns of a select or status board, in the order of the property's
 * options, with the empty group first as Notion shows it.
 *
 * Every option is listed, even one Notion hides while it's empty, because a
 * Bases group order also hides the cards of any group it doesn't list.
 * Multi-select is left to sort itself: Bases groups a list by its whole
 * value, so a page with two tags would match neither tag's column.
 */
function optionOrder(groupBy: BoardConfig['group_by'], properties: NotionProperties): (string | null)[] | null {
	if (groupBy.type !== 'select' && groupBy.type !== 'status') return null;

	const property = Object.values(properties).find(prop => prop.id === groupBy.property_id);
	const options = property?.type === 'select'
		? property.select.options
		: property?.type === 'status' ? property.status.options : undefined;
	if (!options) return null;

	return [null, ...options.map(option => option.name)];
}

/** The properties a card shows, title first because Bases titles a card with its first property. */
function cardProperties(config: BoardConfig, keyById: ReadonlyMap<string, string>): string[] {
	const keys = (config.properties ?? [])
		.filter(prop => prop.visible)
		.map(prop => keyById.get(prop.property_id))
		.filter((key): key is string => key !== undefined && key !== 'file.name');

	return ['file.name', ...keys];
}

function coverProperty(config: BoardConfig, keyById: ReadonlyMap<string, string>, coverPropertyName: string): string | null {
	const cover = config.cover;
	if (cover?.type === 'page_cover') return propertyId(coverPropertyName);
	if (cover?.type !== 'property' || !cover.property_id) return null;

	const key = keyById.get(cover.property_id);
	return key ? propertyId(key) : null;
}
