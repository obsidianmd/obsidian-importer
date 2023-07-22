import { FormatImporter } from "format-importer";
import { App, htmlToMarkdown } from "obsidian";

export class HtmlImporter extends FormatImporter {
	id = 'html';
	name = `HTML (.html)`;
	extensions = ['html'];
	defaultExportFolerName = 'HTML';

	constructor(app: App) {
		super(app);

		this.addTransformer(input => htmlToMarkdown(input));
	}
}
