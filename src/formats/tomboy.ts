import { Notice } from 'obsidian';
import { FormatImporter } from '../format-importer';
import { ImportContext } from '../main';

interface ContentSection {
	text: string;
	xmlPath: string;
}

interface ContentLine {
	contentSections: Array<ContentSection>;
}

interface TomboyNote {
	title: string;
	content: Array<ContentLine>;
	tags: string[];
}

export class TomboyImporter extends FormatImporter {
	init() {
		this.addFileChooserSetting('Tomboy', ['note'], true);
		this.addOutputLocationSetting('Tomboy import');
	}

	async import(ctx: ImportContext): Promise<void> {
		const { files } = this;
		if (files.length === 0) {
			new Notice('Please pick at least one file to import.');
			return;
		}

		const folder = await this.getOutputFolder();
		if (!folder) {
			new Notice('Please select a location to export to.');
			return;
		}

		ctx.reportProgress(0, files.length);
		for (let i = 0; i < files.length; i++) {
			if (ctx.isCancelled()) return;

			const file = files[i];
			ctx.status('Processing ' + file.name);
			try {
				await this.processFile(ctx, folder, file);
				ctx.reportNoteSuccess(file.fullpath);
			} catch (e) {
				ctx.reportFailed(file.fullpath, e);
			}

			ctx.reportProgress(i + 1, files.length);
		}
	}

	private async processFile(ctx: ImportContext, folder: any, file: any): Promise<void> {
		const xmlContent = await file.readText();
		const tomboyNote = this.parseTomboyXML(xmlContent);
		const markdownContent = this.convertToMarkdown(tomboyNote);
		await this.saveAsMarkdownFile(folder, tomboyNote.title, markdownContent);
	}

	private parseTomboyXML(xmlContent: string): TomboyNote {
		const parser = new DOMParser();
		const doc = parser.parseFromString(xmlContent, 'text/xml');

		const title = doc.querySelector('title')?.textContent || 'Untitled';
		const textElement = doc.querySelector('text');

		let content: Array<ContentLine> = [];
		if (textElement) {
			content = this.parseContentStructure(textElement);
		}

		const tagsElement = doc.querySelector('tags');
		const tags = tagsElement?.textContent ? tagsElement.textContent.split(',').map(tag => tag.trim()) : [];

		return { title, content, tags };
	}

	private parseContentStructure(textElement: Element): Array<ContentLine> {
		const lines: Array<ContentLine> = [];
		const noteContent = textElement.querySelector('note-content');

		if (!noteContent) return lines;

		// Recursively parse the XML structure
		const contentLine: ContentLine = {
			contentSections: this.extractContentSections(noteContent, '')
		};

		lines.push(contentLine);
		return lines;
	}

	private extractContentSections(element: Element, currentPath: string): Array<ContentSection> {
		const sections: Array<ContentSection> = [];

		// Convert NodeList to Array for iteration
		Array.from(element.childNodes).forEach(child => {
			if (child.nodeType === Node.TEXT_NODE) {
				// Plain text node
				const text = child.textContent?.trim();
				if (text) {
					sections.push({
						text: text,
						xmlPath: currentPath
					});
				}
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				const el = child as Element;
				const tagName = el.tagName;
				const newPath = currentPath ? `${currentPath}/${tagName}` : tagName;

				// For leaf elements with text content, create a section
				if (el.textContent && el.children.length === 0) {
					sections.push({
						text: el.textContent,
						xmlPath: newPath
					});
				} else {
					// Recursively process child elements
					sections.push(...this.extractContentSections(el, newPath));
				}
			}
		});

		return sections;
	}

	private convertToMarkdown(note: TomboyNote): string {
		// Convert structured content to markdown
		let markdownContent = this.convertStructuredContent(note.content);

		// Remove the title from the beginning of content (Tomboy duplicates it)
		if (markdownContent.startsWith(note.title + '\n\n')) {
			markdownContent = markdownContent.substring(note.title.length + 2);
		}

		// Add tags as YAML frontmatter if present
		let frontmatter = '';
		if (note.tags.length > 0) {
			frontmatter = `---\ntags: [${note.tags.map(tag => `"${tag}"`).join(', ')}]\n---\n\n`;
		}

		return frontmatter + markdownContent;
	}

	private convertStructuredContent(contentLines: Array<ContentLine>): string {
		let result = '';

		contentLines.forEach(line => {
			line.contentSections.forEach(section => {
				let text = section.text;

				// Apply formatting based on xmlPath
				if (section.xmlPath.includes('link:internal')) {
					text = `[[${text}]]`;
				} else if (section.xmlPath.includes('bold')) {
					text = `**${text}**`;
				} else if (section.xmlPath.includes('italic')) {
					text = `*${text}*`;
				} else if (section.xmlPath.includes('strikethrough')) {
					text = `~~${text}~~`;
				} else if (section.xmlPath.includes('monospace')) {
					text = `\`${text}\``;
				} else if (section.xmlPath.includes('highlight')) {
					text = `==${text}==`;
				} else if (section.xmlPath.includes('size:huge')) {
					text = `# ${text}`;
				} else if (section.xmlPath.includes('size:large')) {
					text = `## ${text}`;
				}

				result += text;
			});
			result += '\n';
		});

		return result.trim();
	}


}
