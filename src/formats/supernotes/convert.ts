/**
 * Supernotes cards to Markdown notes, outside the vault.
 *
 * A Supernotes export is a flat set of cards, each naming its parents. The
 * converter turns that into a tree: every card chooses one primary parent, the
 * notes mirror that tree as folders, and `[text](^id)` card links become
 * wikilinks to wherever the target ended up.
 *
 * Cards in Supernotes are small, so there is an option to fold everything
 * beneath a top-level card into one note, with each card as a nested section.
 * Links to a folded card point at its heading.
 */
import { outsideMarkdownCode, outsideMarkdownCodeAsync, outsideMarkdownFences } from '../../markdown';
import { availableFileName, sanitizeFileName, sanitizeTag, serializeFrontMatter } from '../../util';
import { SupernotesCard, supernotesTime } from './models';

export interface SupernotesConversionOptions {
	/**
	 * Cards whose descendants are folded into their note as nested sections.
	 * A card below one of these is written into the highest such ancestor.
	 */
	mergeInto: ReadonlySet<string>;
}

export const supernotesDefaults: SupernotesConversionOptions = {
	mergeInto: new Set(),
};

/** A card with children, and those of its descendants that have children of their own. */
export interface SupernotesParentCard {
	id: string;
	name: string;
	/** Every card beneath it, at any depth. */
	descendants: number;
	children: SupernotesParentCard[];
}

export interface SupernotesMergedCard {
	card: SupernotesCard;
	/** Heading level the card's name is written at. */
	level: number;
}

export interface SupernotesNote {
	card: SupernotesCard;
	/** Folder below the output folder; empty at its top. */
	folder: string;
	/** File name without the extension, unique across the export. */
	name: string;
	/** Cards folded into this note, in reading order. */
	merged: SupernotesMergedCard[];
	ctime?: number;
	mtime?: number;
}

export interface SupernotesRenderOptions {
	/**
	 * Where an upload hosted by Supernotes was placed in the vault, or null to
	 * leave its URL in the note.
	 */
	resolveAttachment?: (url: string) => Promise<string | null>;
}

/** `[text](^card-id)`, how Supernotes writes a link to another card. */
const CARD_LINK = /\[([^\]]*)\]\(\^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

/** A link or image whose target is a file uploaded to Supernotes. */
const UPLOAD_LINK = /(!?)\[([^\]]*)\]\((https:\/\/supernotes-resources\.s3\.amazonaws\.com\/[^)\s]+)\)/g;

const HEADING_LINE = /^(#{1,6})(\s.*)?$/gm;

/** Heading text Obsidian can link to with `[[Note#Heading]]`. */
export function headingText(name: string): string {
	return name.replace(/[#|[\]^\n\r]/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}

function supernotesTag(tag: string): string {
	return sanitizeTag(tag).trim().replace(/\s+/g, '-');
}

async function replaceAsync(
	text: string,
	pattern: RegExp,
	replacement: (match: RegExpExecArray) => Promise<string>,
): Promise<string> {
	const matches = [...text.matchAll(pattern)];
	if (matches.length === 0) return text;

	let written = '';
	let from = 0;
	for (const match of matches) {
		written += text.slice(from, match.index) + await replacement(match);
		from = match.index + match[0].length;
	}
	return written + text.slice(from);
}

export class SupernotesConverter {
	private readonly cards = new Map<string, SupernotesCard>();
	/** The parent each card is filed under, or null at the top. */
	private readonly primary = new Map<string, string | null>();
	private readonly children = new Map<string, string[]>();
	/** Which note each card is written into: itself, or the top-level card it was folded into. */
	private readonly owners = new Map<string, string>();
	private readonly notes = new Map<string, SupernotesNote>();
	/** Names of cards linked to but not exported, from every card's link cache. */
	private readonly linkedNames = new Map<string, string>();

	constructor(cards: SupernotesCard[], private readonly options: SupernotesConversionOptions = supernotesDefaults) {
		for (const card of cards) this.cards.set(card.data.id, card);

		for (const card of cards) {
			for (const [id, name] of Object.entries(card.data.link_cache ?? {})) {
				if (!this.cards.has(id) && typeof name === 'string') this.linkedNames.set(id, name);
			}
		}

		this.buildTree();
		this.planNotes();
	}

	/** Every note to write, in the export's order. */
	get planned(): SupernotesNote[] {
		return [...this.notes.values()];
	}

	/** The cards that could absorb their descendants, as a tree of top-level parents downward. */
	parentCards(): SupernotesParentCard[] {
		const describe = (id: string): SupernotesParentCard | null => {
			const children = this.children.get(id) ?? [];
			if (children.length === 0) return null;

			return {
				id,
				name: this.cards.get(id)?.data.name ?? '',
				descendants: this.countDescendants(id),
				children: children.map(describe).filter((child): child is SupernotesParentCard => child !== null),
			};
		};

		return [...this.cards.keys()]
			.filter(id => (this.primary.get(id) ?? null) === null)
			.map(describe)
			.filter((parent): parent is SupernotesParentCard => parent !== null);
	}

	private countDescendants(id: string): number {
		return (this.children.get(id) ?? []).reduce((total, child) => total + 1 + this.countDescendants(child), 0);
	}

	/**
	 * Where a wikilink to a card should point: a note name, or a heading in
	 * the note the card was folded into. A card that is not in the export is
	 * linked by name when any exported card remembers it, so the link still
	 * reads well even though it has nowhere to go.
	 */
	linkTarget(id: string): string | null {
		const owner = this.owners.get(id);
		if (owner === undefined) {
			const name = this.linkedNames.get(id);
			return name === undefined ? null : sanitizeFileName(name);
		}

		const note = this.notes.get(owner);
		if (!note) return null;
		if (owner === id) return note.name;

		const card = this.cards.get(id);
		return `${note.name}#${headingText(card?.data.name ?? '')}`;
	}

	templateVariables(note: SupernotesNote): Record<string, unknown> {
		const { data } = note.card;
		return {
			name: data.name,
			color: data.color ?? undefined,
			icon: data.icon ?? undefined,
			dailyDate: data.daily_date ?? undefined,
			tags: data.tags ?? [],
			parents: this.exportedParents(note.card).map(id => this.cards.get(id)?.data.name),
		};
	}

	async render(note: SupernotesNote, options: SupernotesRenderOptions = {}): Promise<string> {
		const sections = [await this.renderCard(note.card, 0, options)];
		for (const { card, level } of note.merged) {
			sections.push(`${'#'.repeat(level)} ${headingText(card.data.name)}`);
			sections.push(await this.renderCard(card, level, options));
		}

		const tags = new Set<string>();
		for (const card of [note.card, ...note.merged.map(merged => merged.card)]) {
			for (const tag of card.data.tags ?? []) {
				const cleaned = supernotesTag(tag);
				if (cleaned) tags.add(cleaned);
			}
		}

		const frontMatter = tags.size > 0 ? serializeFrontMatter({ tags: [...tags] }) : '';
		return frontMatter + sections.filter(Boolean).join('\n\n').trim() + '\n';
	}

	private async renderCard(card: SupernotesCard, headingShift: number, options: SupernotesRenderOptions): Promise<string> {
		const parts: string[] = [];

		// The primary parent is where the note is filed; only the others need saying.
		const elsewhere = this.exportedParents(card)
			.filter(id => id !== this.primary.get(card.data.id))
			.map(id => this.linkTarget(id))
			.filter((target): target is string => target !== null);
		if (elsewhere.length > 0) {
			parts.push(`**Also in:** ${elsewhere.map(target => `[[${target}]]`).join(' | ')}`);
		}

		let markup = card.data.markup ?? '';
		markup = outsideMarkdownCode(markup, segment => this.rewriteCardLinks(segment));
		if (options.resolveAttachment) {
			const { resolveAttachment } = options;
			markup = await outsideMarkdownCodeAsync(markup, segment => this.rewriteUploads(segment, resolveAttachment));
		}
		if (headingShift > 0) markup = demoteHeadings(markup, headingShift);

		markup = markup.trim();
		if (markup) parts.push(markup);

		return parts.join('\n\n');
	}

	private rewriteCardLinks(text: string): string {
		return text.replace(CARD_LINK, (whole: string, label: string, id: string) => {
			const target = this.linkTarget(id);
			if (target === null) return whole;

			if (label && label !== target) return `[[${target}|${label}]]`;
			if (!label && target.includes('#')) {
				// A folded card's heading link would otherwise display as "Note > Heading".
				return `[[${target}|${this.cards.get(id)?.data.name ?? target}]]`;
			}
			return `[[${target}]]`;
		});
	}

	private async rewriteUploads(text: string, resolveAttachment: (url: string) => Promise<string | null>): Promise<string> {
		return await replaceAsync(text, UPLOAD_LINK, async ([whole, embed, label, url]) => {
			const path = await resolveAttachment(url);
			if (path === null) return whole;
			if (embed) return `![[${path}]]`;
			return label ? `[[${path}|${label}]]` : `[[${path}]]`;
		});
	}

	private exportedParents(card: SupernotesCard): string[] {
		const parents = Object.entries(card.parents).filter(([id]) => this.cards.has(id));
		// A card archived under one parent is still filed there, but another parent is a better home.
		parents.sort(([, left], [, right]) => Number(left.archived === true) - Number(right.archived === true));
		return parents.map(([id]) => id);
	}

	private buildTree(): void {
		for (const [id, card] of this.cards) {
			this.primary.set(id, this.exportedParents(card)[0] ?? null);
		}

		// Parent links can form a cycle; cut each one where the walk first returns.
		for (const start of this.cards.keys()) {
			const seen = new Set<string>();
			let current: string | null = start;
			while (current !== null && !seen.has(current)) {
				seen.add(current);
				const parent: string | null = this.primary.get(current) ?? null;
				if (parent !== null && seen.has(parent)) {
					this.primary.set(current, null);
					break;
				}
				current = parent;
			}
		}

		for (const [id, parent] of this.primary) {
			if (parent === null) continue;
			const siblings = this.children.get(parent) ?? [];
			siblings.push(id);
			this.children.set(parent, siblings);
		}

		// The export does not record the order cards appear in; the time each was
		// filed under its parent is the closest stable stand-in.
		for (const [parent, ids] of this.children) {
			ids.sort((left, right) => {
				const leftAt = this.cards.get(left)?.parents[parent]?.created_when ?? '';
				const rightAt = this.cards.get(right)?.parents[parent]?.created_when ?? '';
				return leftAt.localeCompare(rightAt)
					|| (this.cards.get(left)?.data.name ?? '').localeCompare(this.cards.get(right)?.data.name ?? '');
			});
		}
	}

	private ownerOf(id: string): string {
		const { mergeInto } = this.options;
		if (mergeInto.size === 0) return id;

		let owner = id;
		let current: string | null | undefined = this.primary.get(id);
		while (current !== null && current !== undefined) {
			if (mergeInto.has(current)) owner = current;
			current = this.primary.get(current);
		}
		return owner;
	}

	private planNotes(): void {
		for (const id of this.cards.keys()) this.owners.set(id, this.ownerOf(id));

		const noteIds = [...this.cards.keys()].filter(id => this.owners.get(id) === id);

		// Names are unique ignoring case, since the vault may sit on a filesystem that does.
		const taken = new Set<string>();
		const names = new Map<string, string>();
		for (const id of noteIds) {
			const card = this.cards.get(id) as SupernotesCard;
			const name = availableFileName(`${sanitizeFileName(card.data.name)}.md`, candidate => taken.has(candidate.toLowerCase()))
				.slice(0, -'.md'.length);
			taken.add(`${name}.md`.toLowerCase());
			names.set(id, name);
		}

		// A note with child notes gets a folder of its own; a leaf sits in its parent's.
		const noteSet = new Set(noteIds);
		const parentNotes = new Set(noteIds.map(id => this.primary.get(id)).filter((parent): parent is string => parent !== null && parent !== undefined && noteSet.has(parent)));
		const ownFolders = new Map<string, string>();
		const ownFolder = (id: string): string => {
			const known = ownFolders.get(id);
			if (known !== undefined) return known;

			const parent = this.primary.get(id);
			const name = names.get(id) as string;
			const folder = parent === null || parent === undefined || !noteSet.has(parent) ? name : `${ownFolder(parent)}/${name}`;
			ownFolders.set(id, folder);
			return folder;
		};

		for (const id of noteIds) {
			const card = this.cards.get(id) as SupernotesCard;
			const parent = this.primary.get(id);
			let folder = '';
			if (parentNotes.has(id)) folder = ownFolder(id);
			else if (parent !== null && parent !== undefined && noteSet.has(parent)) folder = ownFolder(parent);

			const merged = this.collectMerged(id, id, 2);
			const times = [card, ...merged.map(entry => entry.card)].map(entry => supernotesTime(entry.data.modified_when) ?? 0);

			this.notes.set(id, {
				card,
				folder,
				name: names.get(id) as string,
				merged,
				ctime: supernotesTime(card.data.created_when),
				mtime: Math.max(...times) || undefined,
			});
		}
	}

	private collectMerged(owner: string, parent: string, level: number): SupernotesMergedCard[] {
		const merged: SupernotesMergedCard[] = [];
		for (const child of this.children.get(parent) ?? []) {
			if (this.owners.get(child) !== owner) continue;
			merged.push({ card: this.cards.get(child) as SupernotesCard, level: Math.min(level, 6) });
			merged.push(...this.collectMerged(owner, child, level + 1));
		}
		return merged;
	}
}

/** Push headings down so they nest under a folded card's own heading. Code blocks are left alone. */
export function demoteHeadings(markup: string, levels: number): string {
	if (levels <= 0) return markup;

	return outsideMarkdownFences(markup, segment => segment.replace(HEADING_LINE, (_whole, hashes: string, rest: string | undefined) =>
		'#'.repeat(Math.min(hashes.length + levels, 6)) + (rest ?? '')));
}
