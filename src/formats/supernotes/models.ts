/**
 * The shape of a Supernotes JSON export.
 *
 * The export is one object keyed by card ID. Only the fields the conversion
 * reads are declared; the file carries a great deal more (sync state, Yjs
 * documents, membership permissions) that is left alone.
 */
export interface SupernotesCardData {
	id: string;
	name: string;
	/** The card body, in Supernotes' Markdown dialect. */
	markup: string;
	tags?: string[] | null;
	color?: string | null;
	icon?: string | null;
	/** `YYYY-MM-DD` when the card is a daily card. */
	daily_date?: string | null;
	created_when: string;
	modified_when: string;
	/** Names of cards this one links to, keyed by ID, including cards outside the export. */
	link_cache?: Record<string, string> | null;
}

export interface SupernotesParentLink {
	created_when?: string;
	archived?: boolean | null;
}

export interface SupernotesCard {
	data: SupernotesCardData;
	/** Parent links keyed by parent card ID. */
	parents: Record<string, SupernotesParentLink>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCard(value: unknown): value is SupernotesCard {
	if (!isRecord(value) || !isRecord(value.data)) return false;
	const { data } = value;
	return typeof data.id === 'string'
		&& typeof data.name === 'string'
		&& typeof data.created_when === 'string'
		&& typeof data.modified_when === 'string';
}

/**
 * The cards in an export, in file order, or null when the JSON is not a
 * Supernotes export at all.
 *
 * A card missing the fields the conversion needs is dropped rather than
 * failing the file; the caller is told how many were.
 */
export function parseSupernotesExport(value: unknown): { cards: SupernotesCard[], dropped: number } | null {
	if (!isRecord(value)) return null;

	const cards: SupernotesCard[] = [];
	let dropped = 0;
	for (const entry of Object.values(value)) {
		if (!isCard(entry)) {
			dropped++;
			continue;
		}
		cards.push({
			data: entry.data,
			parents: isRecord(entry.parents) ? entry.parents : {},
		});
	}

	if (cards.length === 0 && dropped > 0) return null;
	return { cards, dropped };
}

/** Supernotes writes UTC timestamps, with or without a zone and with up to six fractional digits. */
export function supernotesTime(value: string | undefined | null): number | undefined {
	if (!value) return undefined;

	const trimmed = value.replace(/(\.\d{3})\d+/, '$1');
	const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed) ? trimmed : `${trimmed}Z`;
	const time = Date.parse(zoned);
	return Number.isNaN(time) ? undefined : time;
}
