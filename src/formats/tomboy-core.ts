export interface ContentSection {
	text: string;
	xmlPath: string;
}

export interface ContentLine {
	contentSections: Array<ContentSection>;
}

export interface TomboyNote {
	title: string;
	content: Array<ContentLine>;
	tags: string[];
}

export class TomboyCoreConverter {
	/**
	 * Parse Tomboy XML content into structured format
	 */
	parseTomboyXML(xmlContent: string): TomboyNote {
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

	/**
	 * Parse the content structure from XML text element
	 */
	private parseContentStructure(textElement: Element): Array<ContentLine> {
		const noteContent = textElement.querySelector('note-content');

		if (!noteContent) return [];

		// Recursively parse the XML structure
		const rawContentSections = this.extractContentSections(noteContent, '');

		return this.splitAndGroupSectionsIntoLines(rawContentSections);
	}

	/**
	 * Split content sections at line breaks and group into lines
	 */
	private splitAndGroupSectionsIntoLines(sections: Array<ContentSection>): Array<ContentLine> {
		// Step 1: Split sections containing line breaks into multiple sections
		const expandedSections: Array<ContentSection> = [];

		sections.forEach(section => {
			const lines = section.text.split('\n');
			lines.forEach((line, index) => {
				if (line.trim()) { // Only add non-empty lines
					expandedSections.push({
						text: line,
						xmlPath: section.xmlPath
					});
				}
				// Add newline section between lines (except after the last line)
				if (index < lines.length - 1) {
					expandedSections.push({
						text: '\n',
						xmlPath: 'newline'
					});
				}
			});
		});

		// Step 2: Group sections into lines
		const lines: Array<ContentLine> = [];
		let currentLineSections: Array<ContentSection> = [];

		expandedSections.forEach(section => {
			if (section.xmlPath === 'newline') {
				// End of current line, start a new one
				lines.push({
					contentSections: currentLineSections
				});
				currentLineSections = [];
			} else {
				// Add to current line
				currentLineSections.push(section);
			}
		});

		// Add the last line if it has content
		if (currentLineSections.length > 0) {
			lines.push({
				contentSections: currentLineSections
			});
		}

		return lines;
	}

	/**
	 * Recursively extract content sections from XML elements
	 */
	private extractContentSections(element: Element, currentPath: string): Array<ContentSection> {
		const sections: Array<ContentSection> = [];

		// Convert NodeList to Array for iteration
		Array.from(element.childNodes).forEach(child => {
			if (child.nodeType === Node.TEXT_NODE) {
				// Plain text node
				const text = child.textContent || '';
				if (text.length > 0) { // Include all text nodes that have any content, including whitespace (like line breaks between elements)
					sections.push({
						text: text,
						xmlPath: currentPath
					});
				}
			} else if (child.nodeType === Node.ELEMENT_NODE) {
				const el = child as Element;
				const tagName = el.tagName;
				const newPath = currentPath ? `${currentPath}/${tagName}` : tagName;

				// For elements with text content, check if they have direct text children
				if (el.textContent) {
					// Check if the element has text children (other than element children)
					let hasTextChildren = false;
					Array.from(el.childNodes).forEach(child => {
						if (child.nodeType === Node.TEXT_NODE && child.textContent && child.textContent.length > 0) {
							hasTextChildren = true;
						}
					});

					// If it's a leaf element (no significant text children to process), use textContent
					if (!hasTextChildren && el.children.length === 0) {
						sections.push({
							text: el.textContent,
							xmlPath: newPath
						});
					} else {
						// Recursively process child elements and text nodes
						sections.push(...this.extractContentSections(el, newPath));
					}
				} else {
					// No text content, still process child elements
					sections.push(...this.extractContentSections(el, newPath));
				}
			}
		});

		return sections;
	}

	/**
	 * Convert structured Tomboy note to Markdown
	 */
	convertToMarkdown(note: TomboyNote): string {
		// Convert structured content to markdown
		let markdownContent = this.convertStructuredContent(note.content);

		// Remove the title from the beginning of content (Tomboy duplicates it)
		// The title appears as the first line in the content, so we need to remove it
		const lines = markdownContent.split('\n');
		if (lines.length > 0 && lines[0].trim() === note.title.trim()) {
			// Remove the title line and any empty lines that follow it
			let startIndex = 1;
			while (startIndex < lines.length && lines[startIndex].trim() === '') {
				startIndex++;
			}
			markdownContent = lines.slice(startIndex).join('\n');
		}

		// Add tags as YAML frontmatter if present
		let frontmatter = '';
		if (note.tags.length > 0) {
			frontmatter = `---\ntags: [${note.tags.map(tag => `"${tag}"`).join(', ')}]\n---\n\n`;
		}

		return frontmatter + markdownContent;
	}

	/**
	 * Convert structured content lines to Markdown
	 */
	private convertStructuredContent(contentLines: Array<ContentLine>): string {
		let result = '';

		contentLines.forEach((line, lineIndex) => {
			let lineText = '';

			// Check if the first section of this line is a list item
			const firstSection = line.contentSections[0];
			let listPrefix = '';
			if (firstSection && firstSection.xmlPath.includes('list-item')) {
				// Calculate nesting depth from xmlPath (e.g., "list/list-item" = depth 1)
				const depth = (firstSection.xmlPath.match(/\/list\//g) || []).length;
				const indent = '    '.repeat(depth);
				listPrefix = indent + '- ';
			}

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
				}
				// Note: Size tags (headings) will be handled separately after basic functionality works

				lineText += text;
			});

			// Add list prefix to the line if it's a list item
			result += listPrefix + lineText;

			// Add newline after each line (except potentially the last one)
			if (lineIndex < contentLines.length - 1) {
				result += '\n';
			}
		});

		return result;
	}
}
