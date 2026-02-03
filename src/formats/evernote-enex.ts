import { FileSystemAdapter, Notice, Setting } from 'obsidian';
import { path } from '../filesystem';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';
import { defaultYarleOptions, dropTheRope } from './yarle/yarle';

export class EvernoteEnexImporter extends FormatImporter {
	private includeTitleInFrontmatter: boolean;
	private includeCreationTimeInFrontmatter: boolean;
	private includeUpdateTimeInFrontmatter: boolean;

	init() {
		this.addFileChooserSetting('Evernote', ['enex'], true);
		this.addOutputLocationSetting('Evernote');

		this.includeTitleInFrontmatter = false;
		let titleDescFragment = new DocumentFragment();
		titleDescFragment.createSpan({ text: 'This preserves titles with special characters like slashes, although you\'ll need a plugin like ' });
		titleDescFragment.createEl('a', {
			text: 'Front Matter Title',
			href: 'https://github.com/snezhig/obsidian-front-matter-title',
		});
		titleDescFragment.createSpan({ text: ' to display them.' });
		new Setting(this.modal.contentEl)
			.setName('Include original title in frontmatter')
			.setDesc(titleDescFragment)
			.addToggle(toggle => {
				toggle.setValue(this.includeTitleInFrontmatter);
				toggle.onChange(async (value) => {
					this.includeTitleInFrontmatter = value;
				});
			});

		this.includeCreationTimeInFrontmatter = false;
		new Setting(this.modal.contentEl)
			.setName('Include created date in frontmatter')
			.addToggle(toggle => {
				toggle.setValue(this.includeCreationTimeInFrontmatter);
				toggle.onChange(async (value) => {
					this.includeCreationTimeInFrontmatter = value;
				});
			});

		this.includeUpdateTimeInFrontmatter = false;
		new Setting(this.modal.contentEl)
			.setName('Include updated date in frontmatter')
			.addToggle(toggle => {
				toggle.setValue(this.includeUpdateTimeInFrontmatter);
				toggle.onChange(async (value) => {
					this.includeUpdateTimeInFrontmatter = value;
				});
			});
	}

	async import(ctx: ImportContext) {
		let { files } = this;
		if (files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		let folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		let { app } = this;
		let adapter = app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;

		let yarleOptions = {
			...defaultYarleOptions,
			...{
				enexSources: files,
				outputDir: path.join(adapter.getBasePath(), folder.path),
				includeTitleInFrontmatter: this.includeTitleInFrontmatter,
				includeCreationTimeInFrontmatter: this.includeCreationTimeInFrontmatter,
				includeUpdateTimeInFrontmatter: this.includeUpdateTimeInFrontmatter,
			},
		};

		await dropTheRope(yarleOptions, ctx);
	}
}
