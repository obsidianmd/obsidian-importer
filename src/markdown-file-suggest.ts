import { AbstractInputSuggest, App, FuzzyMatch, prepareFuzzySearch, renderMatches, sortSearchResults, TFile } from 'obsidian';

/** Suggest Markdown files already present in the vault. */
export class MarkdownFileSuggest extends AbstractInputSuggest<FuzzyMatch<TFile>> {
	private readonly inputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	protected getSuggestions(query: string): FuzzyMatch<TFile>[] {
		const search = prepareFuzzySearch(query);
		const matches: FuzzyMatch<TFile>[] = [];

		for (const file of this.app.vault.getMarkdownFiles()) {
			const match = search(file.path);
			if (match) matches.push({ item: file, match });
		}

		sortSearchResults(matches);
		return matches;
	}

	renderSuggestion(value: FuzzyMatch<TFile>, el: HTMLElement): void {
		renderMatches(el, value.item.path, value.match.matches);
	}

	selectSuggestion(value: FuzzyMatch<TFile>, evt: MouseEvent | KeyboardEvent): void {
		this.setValue(value.item.path);
		// setValue does not fire the event used by the setting.
		this.inputEl.trigger('input');
		this.close();
		super.selectSuggestion(value, evt);
	}
}
