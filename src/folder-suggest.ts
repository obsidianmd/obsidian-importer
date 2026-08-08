import { AbstractInputSuggest, App, FuzzyMatch, prepareFuzzySearch, renderMatches, sortSearchResults, TFolder } from 'obsidian';

export class FolderSuggest extends AbstractInputSuggest<FuzzyMatch<TFolder>> {
	private readonly inputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	protected getSuggestions(query: string): FuzzyMatch<TFolder>[] {
		const search = prepareFuzzySearch(query);
		const matches: FuzzyMatch<TFolder>[] = [];

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
		// setValue does not fire the event used by the setting.
		this.inputEl.trigger('input');
		this.close();
		super.selectSuggestion(value, evt);
	}
}
