import { AbstractInputSuggest, App, FuzzyMatch, prepareFuzzySearch, renderMatches, sortSearchResults, TFolder } from 'obsidian';

/**
 * Type-ahead over the folders already in the vault, for a setting that takes a
 * folder path.
 *
 * The input stays free text. An import usually writes to a folder that is not
 * there yet - the importer creates it - and there is nothing to suggest for a
 * folder that does not exist, so this only offers to complete what does.
 */
export class FolderSuggest extends AbstractInputSuggest<FuzzyMatch<TFolder>> {
	/**
	 * The element the suggestions are attached to.
	 *
	 * AbstractInputSuggest holds one too, but does not declare it, so this
	 * keeps its own rather than reaching for a field the API does not promise.
	 */
	private readonly inputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	protected getSuggestions(query: string): FuzzyMatch<TFolder>[] {
		const search = prepareFuzzySearch(query);
		const matches: FuzzyMatch<TFolder>[] = [];

		// The root included: writing to it is what an empty path means, and a
		// vault with no folders would otherwise suggest nothing at all.
		for (const folder of this.app.vault.getAllFolders(true)) {
			const match = search(folder.path);
			if (match) {
				matches.push({ item: folder, match });
			}
		}

		sortSearchResults(matches);
		return matches;
	}

	renderSuggestion(value: FuzzyMatch<TFolder>, el: HTMLElement): void {
		renderMatches(el, value.item.path, value.match.matches);
	}

	selectSuggestion(value: FuzzyMatch<TFolder>, evt: MouseEvent | KeyboardEvent): void {
		this.setValue(value.item.path);
		// setValue writes the element's value directly, which fires nothing.
		// The setting is listening for input, so say so, or the path shows in
		// the box and the importer never hears about it.
		this.inputEl.trigger('input');
		this.close();
		super.selectSuggestion(value, evt);
	}
}
