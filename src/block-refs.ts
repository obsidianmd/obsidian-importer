export interface BlockLocation {
	page: string;
	anchor: string;
}

export class BlockIndex {
	private located = new Map<string, BlockLocation>();
	private mentioned = new Set<string>();

	define(id: string, page: string, anchor: string = id): void {
		this.located.set(id, { page, anchor });
	}

	mention(id: string): void {
		this.mentioned.add(id);
	}

	isReferenced(id: string): boolean {
		return this.mentioned.has(id) && this.located.has(id);
	}

	resolve(id: string): BlockLocation | null {
		return this.located.get(id) ?? null;
	}

	has(id: string): boolean {
		return this.located.has(id);
	}
}
