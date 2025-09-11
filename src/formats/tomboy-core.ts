import path from "path";

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

/**
 * Tracks formatting spans for proper tag ordering
 */
interface FormatSpan {
	format: string;
	openTag: string;
	closeTag: string;
}

export class TomboyCoreConverter {
	/**
	 * Stack to track active formatting spans for proper tag ordering
	 */
	private activeFormatStack: FormatSpan[] = [];

	/**
	 * Flag to enable TODO list functionality
	 */
	private todoEnabled: boolean = true;

	/**
	 * Track the most recent TODO heading for context-aware TODO mode
	 */
	private currentTodoHeading: { level: number } | null = null;

	/**
	 * Enable or disable TODO list processing
	 */
	setTodoEnabled(enabled: boolean): void {
		this.todoEnabled = enabled;
	}

	/**
	 * Check if all sections of a list item have strikethrough formatting (simplified requirement)
	 */
	private isFullyStrikethrough(sections: Array<ContentSection>): boolean {
		return sections.every(section => section.xmlPath.includes('strikethrough'));
	}

	/**
	 * Check if a note title contains TODO keywords
	 */
	private isTodoTitle(title: string): boolean {
		const todoKeywords = ['TODO', 'Todo', 'To Do', 'todo', 'to do', 'ToDo'];
		return todoKeywords.some(keyword => title.includes(keyword));
	}

	/**
	 * Update TODO context based on heading level and text
	 */
	private updateTodoContext(headingLevel: number, headingText: string): void {
		// Only update if this heading is at same level or higher than current TODO heading
		if (!this.currentTodoHeading || headingLevel <= this.currentTodoHeading.level) {
			const isTodo = this.isTodoTitle(headingText);
			this.currentTodoHeading = isTodo
					? { level: headingLevel }
					: null;
		}
	}

	private isTodoMode() : boolean {
		return this.todoEnabled && this.currentTodoHeading !== null;
	}

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
				if (line) {
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
			console.log("XX" + child.nodeType + "----" + child.textContent + "---" + (child as Element).tagName);
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
					const hasTextChildren = Array.from(el.childNodes).some(child =>
						child.nodeType === Node.TEXT_NODE && child.textContent && child.textContent.length > 0
					);

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
		// Initialize TODO context based on title, treat like H1 heading
		this.updateTodoContext(1, note.title);

		// Convert structured content to markdown
		let markdownContent = this.convertStructuredContent(note.content, note.title);

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
	 * Escape markdown special characters in text
	 */
	private escapeMarkdownSpecialChars(text: string): string {
		// Escape markdown special characters that could interfere with formatting
		return text.replace(/([\\`*_\[\]#])/g, '\\$1');
	}

	/**
	 * Stream-based formatting analysis for a line of content sections
	 */
	private formatLineStream(sections: Array<ContentSection>, isBoldIgnored: boolean, removeStrikethrough: boolean = false): string {
		let result = '';
		let activeFormats: Set<string> = new Set();
		let trailingWhitespacePrevious = '';

		sections.forEach((section, sectionIndex) => {
			let sectionText = section.text;

			// Extract and preserve whitespace that should stay outside formatting
			const { coreText, leadingWhitespace, trailingWhitespace } = this.extractWhitespaceFromText(sectionText);

			// Escape markdown special characters in core text to prevent interference
			const escapedCoreText = this.escapeMarkdownSpecialChars(coreText);

			// Determine formatting changes for this section's core content
			const formats: { [key: string]: boolean } = {
				strikethrough: !removeStrikethrough && section.xmlPath.includes('strikethrough'),
				highlight: section.xmlPath.includes('highlight'),
				bold: !isBoldIgnored && section.xmlPath.includes('bold'),
				italic: section.xmlPath.includes('italic'),
				monospace: section.xmlPath.includes('monospace'),
			};

			const isLink = section.xmlPath.includes('link:internal');

			// Handle formatting transitions for core content
			const formatChanges = this.calculateFormattingChanges(activeFormats, formats);

			// Apply closing formats before trailing whitespace
			result += formatChanges.closeTags;

			// Add whitespace (always outside formatting)
			result += trailingWhitespacePrevious + leadingWhitespace;

			// Apply opening formats before core text
			result += formatChanges.openTags;

			// Push new spans to stack (after opening tags are applied)
			if (formatChanges.openingSpans) {
				formatChanges.openingSpans.forEach(span => this.activeFormatStack.push(span));
			}

			// Internal links are always assumed to span just 1 section
			if (isLink) {
				result += `[[`;
			}

			// Add the escaped core section text
			result += escapedCoreText;

			if (isLink) {
				result += `]]`;
			}

			// Update active formats
			activeFormats = new Set(Object.keys(formats).filter(key => formats[key]));

			trailingWhitespacePrevious = trailingWhitespace;
		});

		// Close any remaining formats from stack (preserves proper ordering)
		while (this.activeFormatStack.length > 0) {
			result += this.activeFormatStack.pop()!.closeTag;
		}

		return result;
	}

	/**
	 * Calculate formatting changes between current and new format states using stack-based ordering
	 */
	private calculateFormattingChanges(currentFormats: Set<string>, newFormats: { [key: string]: boolean }) {
		const closeTags: string[] = [];

		// Handle closing tags first - must be in reverse order of nesting
		while (this.activeFormatStack.length > 0) {
			const lastSpan = this.activeFormatStack[this.activeFormatStack.length - 1];
			const format = lastSpan.format;

			if (!newFormats[format]) {
				// This format ends - close it and remove from stack
				closeTags.push(lastSpan.closeTag);
				this.activeFormatStack.pop();
			} else {
				// This format continues - stop checking (maintains proper nesting order)
				break;
			}
		}

		// Handle opening tags - push to stack in opening order
		const openingFormats: FormatSpan[] = [];
		Object.keys(newFormats).forEach(format => {
			if (newFormats[format] && !currentFormats.has(format)) {
				const tag = this.getMarkdownTag(format);
				const span: FormatSpan = {
					format: format,
					openTag: tag.open,
					closeTag: tag.close
				};
				openingFormats.push(span);
				// Don't push to stack yet - only push after we've finalized all changes
			}
		});

		return {
			closeTags: closeTags.join(''),
			openTags: openingFormats.map(span => span.openTag).join(''),
			openingSpans: openingFormats
		};
	}

	/**
	 * Get markdown tag pair for a formatting type
	 */
	private getMarkdownTag(format: string): { open: string, close: string } {
		switch (format) {
			case 'bold':
				return { open: '**', close: '**' };
			case 'italic':
				return { open: '*', close: '*' };
			case 'strikethrough':
				return { open: '~~', close: '~~' };
			case 'monospace':
				return { open: '`', close: '`' };
			case 'highlight':
				return { open: '==', close: '==' };
			default:
				return { open: '', close: '' };
		}
	}

	/**
	 * Extract whitespace from text and return core content separately
	 */
	private extractWhitespaceFromText(text: string): { coreText: string, leadingWhitespace: string, trailingWhitespace: string } {
		const leadingWhitespace = text.match(/^\s*/)![0];
		const trailingWhitespace = text.match(/\s*$/)![0];

		// If text is only whitespace, count it as leading whitespace only
		if (leadingWhitespace.length === text.length) {
			return { coreText: '', leadingWhitespace: text, trailingWhitespace: '' };
		}

		const coreText = text.substring(leadingWhitespace.length, text.length - trailingWhitespace.length);
		return { coreText, leadingWhitespace, trailingWhitespace };
	}

	/**
	 * Convert structured content lines to Markdown
	 */
	private convertStructuredContent(contentLines: Array<ContentLine>, noteTitle: string): string {
		let result = '';

		contentLines.forEach((line, lineIndex) => {
			let lineText = '';

			// Check if the first section of this line is a list item
			const firstSection = line.contentSections[0];
			let listPrefix = '';
			const isInTodoMode = this.isTodoMode(); // Declare outside if block
			let isCompletedTodoItem = false;

			if (firstSection && firstSection.xmlPath.includes('list-item')) {
				// Calculate nesting depth from xmlPath (e.g., "list/list-item" = depth 1)
				const depth = (firstSection.xmlPath.match(/\/list\//g) || []).length;
				const indent = '    '.repeat(depth);

				if (isInTodoMode) {
					// Use simplified strikethrough detection: all sections must be strikethrough
					isCompletedTodoItem = this.isFullyStrikethrough(line.contentSections);
					const checkboxState = isCompletedTodoItem ? '[x]' : '[ ]';
					listPrefix = indent + '- ' + checkboxState + ' ';
				} else {
					// Regular list item
					listPrefix = indent + '- ';
				}
			}

			// Check for headings (entire line analysis) - lists already handled above
			let headingPrefix = '';
			let isBoldConsumedInHeading = false;
			if (line.contentSections.length > 0 && listPrefix === '') {
				const paths = line.contentSections.map(section => section.xmlPath);
				const allBold = paths.every(path => path.includes('bold'));
				const allHuge = paths.every(path => path.includes('size:huge'));
				const allLarge = paths.every(path => path.includes('size:large'));

				if (allBold || allHuge || allLarge) {
					// Calculate heading level based on formatting
					let headingLevel = 6;
					if(allHuge) {
						headingLevel -= 4;
					} else if(allLarge) {
						headingLevel -= 2;
					}
					if(allBold) {
						headingLevel -= 1;
						isBoldConsumedInHeading = true;
					}

					const hashes = '#'.repeat(headingLevel);
					headingPrefix = hashes + ' ';

					// Update TODO context based on heading text
					const headingText = line.contentSections.map(section => section.text).join('').trim();
					this.updateTodoContext(headingLevel, headingText);
				}
			}

			// Stream-based formatting: analyze entire line for proper tag placement
			lineText = this.formatLineStream(line.contentSections, isBoldConsumedInHeading, isCompletedTodoItem);

			// Apply heading or list prefix to the line
			if (headingPrefix) {
				result += headingPrefix + lineText.trim();
			} else {
				result += listPrefix + lineText;
			}

			// Add newline after each line (except potentially the last one)
			if (lineIndex < contentLines.length - 1) {
				result += '\n';
			}
		});

		return result;
	}
}
