/**
 * Where the blocks of a graph are, for the references that point at them.
 *
 * An outliner lets one block name another by an id, and the block it names can
 * live on any page - so a note cannot be finished until the whole graph has
 * been read. Every importer of one of these formats needs the same two
 * answers, whatever the markup spells them as: where is the block with this
 * id, and does anything point at this block.
 *
 * The second is worth keeping apart from the first. An anchor is only wanted
 * on a block something reaches for; writing one onto every block that carries
 * an id leaves `^ids` down a page for no reason.
 */

/** Where a block ended up, for a reference or an embed that has to reach it. */
export interface BlockLocation {
	/** The note the block is on, as the importer names notes. */
	page: string;
	/** The anchor written on the block, which a link joins to the note with `#^`. */
	anchor: string;
}

export class BlockIndex {
	private located = new Map<string, BlockLocation>();
	private mentioned = new Set<string>();

	/**
	 * Remember a block that carries an id.
	 *
	 * The anchor defaults to the id, which is what a format whose ids are
	 * already short and legal wants. One writing long ids - a uuid - passes the
	 * shortened form it means to write on the block instead.
	 */
	define(id: string, page: string, anchor: string = id): void {
		this.located.set(id, { page, anchor });
	}

	/** Note that something points at this id, whether or not a block has it. */
	mention(id: string): void {
		this.mentioned.add(id);
	}

	/**
	 * Whether the block with this id needs an anchor: something points at it,
	 * and it is really there. `((a passing thought))` reads as a reference in
	 * most of these formats and is nobody's id.
	 */
	isReferenced(id: string): boolean {
		return this.mentioned.has(id) && this.located.has(id);
	}

	/** Where the block is, or nothing when the graph holds no such block. */
	resolve(id: string): BlockLocation | null {
		return this.located.get(id) ?? null;
	}

	has(id: string): boolean {
		return this.located.has(id);
	}
}
