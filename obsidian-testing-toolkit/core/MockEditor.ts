/**
 * Obsidian Testing Toolkit - Mock Editor Implementation
 *
 * Mock implementation of Obsidian's Editor interface based on CodeMirror.
 * Provides text editing, cursor management, and selection handling for testing.
 *
 * @author Obsidian Testing Toolkit
 * @version 1.0.0
 */

import { EventEmitter } from 'events';

/**
 * Editor position interface
 */
export interface EditorPosition {
  line: number;
  ch: number;
}

/**
 * Editor range interface
 */
export interface EditorRange {
  from: EditorPosition;
  to: EditorPosition;
}

/**
 * Editor selection interface
 */
export interface EditorSelection {
  anchor: EditorPosition;
  head: EditorPosition;
}

/**
 * Editor change interface
 */
export interface EditorChange {
  from: EditorPosition;
  to: EditorPosition;
  text: string[];
  removed: string[];
  origin?: string;
}

/**
 * Configuration options for MockEditor
 */
export interface MockEditorConfig {
  initialContent?: string;
  mode?: string;
  readOnly?: boolean;
  lineWrapping?: boolean;
  lineNumbers?: boolean;
}

/**
 * Mock implementation of Obsidian's Editor
 */
export class MockEditor extends EventEmitter {
  private content: string[];
  private cursor: EditorPosition;
  private selection: EditorSelection | null = null;
  private history: EditorChange[] = [];
  private historyIndex: number = -1;
  private config: MockEditorConfig;
  private readOnly: boolean;

  constructor(config: MockEditorConfig = {}) {
    super();
    this.config = config;
    this.content = config.initialContent ? config.initialContent.split('\n') : [''];
    this.cursor = { line: 0, ch: 0 };
    this.readOnly = config.readOnly || false;
  }

  /**
   * Get the total number of lines
   */
  public lineCount(): number {
    return this.content.length;
  }

  /**
   * Get the content of a specific line
   */
  public getLine(line: number): string {
    if (line < 0 || line >= this.content.length) {
      throw new Error(`Line ${line} out of bounds`);
    }
    return this.content[line];
  }

  /**
   * Get the last line number
   */
  public lastLine(): number {
    return this.content.length - 1;
  }

  /**
   * Get text in a range
   */
  public getRange(from: EditorPosition, to: EditorPosition): string {
    this.validatePosition(from);
    this.validatePosition(to);

    if (from.line === to.line) {
      return this.content[from.line].substring(from.ch, to.ch);
    }

    const lines: string[] = [];
    lines.push(this.content[from.line].substring(from.ch));

    for (let i = from.line + 1; i < to.line; i++) {
      lines.push(this.content[i]);
    }

    lines.push(this.content[to.line].substring(0, to.ch));
    return lines.join('\n');
  }

  /**
   * Get all content
   */
  public getValue(): string {
    return this.content.join('\n');
  }

  /**
   * Set all content
   */
  public setValue(content: string): void {
    if (this.readOnly) {
      throw new Error('Editor is read-only');
    }

    const oldContent = this.content.slice();
    this.content = content.split('\n');
    this.cursor = { line: 0, ch: 0 };
    this.selection = null;

    const change: EditorChange = {
      from: { line: 0, ch: 0 },
      to: { line: oldContent.length - 1, ch: oldContent[oldContent.length - 1].length },
      text: this.content,
      removed: oldContent,
      origin: 'setValue'
    };

    this.addToHistory(change);
    this.emit('change', this, change);
  }

  /**
   * Replace text in a range
   */
  public replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition): void {
    if (this.readOnly) {
      throw new Error('Editor is read-only');
    }

    this.validatePosition(from);
    const actualTo = to || from;
    this.validatePosition(actualTo);

    const removed = this.getRange(from, actualTo).split('\n');
    const newLines = replacement.split('\n');

    // Build the change
    const change: EditorChange = {
      from,
      to: actualTo,
      text: newLines,
      removed,
      origin: 'replaceRange'
    };

    // Apply the change
    if (from.line === actualTo.line) {
      // Single line replacement
      const line = this.content[from.line];
      this.content[from.line] = line.substring(0, from.ch) + replacement + line.substring(actualTo.ch);
    } else {
      // Multi-line replacement
      const firstLine = this.content[from.line].substring(0, from.ch) + newLines[0];
      const lastLine = newLines[newLines.length - 1] + this.content[actualTo.line].substring(actualTo.ch);

      const newContent = [
        ...this.content.slice(0, from.line),
        firstLine,
        ...newLines.slice(1, -1),
        lastLine,
        ...this.content.slice(actualTo.line + 1)
      ];

      this.content = newContent;
    }

    this.addToHistory(change);
    this.emit('change', this, change);
  }

  /**
   * Replace selection with text
   */
  public replaceSelection(replacement: string): void {
    if (this.selection) {
      this.replaceRange(replacement, this.selection.anchor, this.selection.head);
      this.clearSelection();
    } else {
      this.replaceRange(replacement, this.cursor);
    }
  }

  /**
   * Get current cursor position
   */
  public getCursor(): EditorPosition {
    return { ...this.cursor };
  }

  /**
   * Set cursor position
   */
  public setCursor(pos: EditorPosition | number, ch?: number): void {
    if (typeof pos === 'number') {
      pos = { line: pos, ch: ch || 0 };
    }

    this.validatePosition(pos);
    this.cursor = { ...pos };
    this.clearSelection();
    this.emit('cursorActivity', this);
  }

  /**
   * Get current selection
   */
  public getSelection(): string {
    if (!this.selection) {
      return '';
    }
    return this.getRange(this.selection.anchor, this.selection.head);
  }

  /**
   * Set selection
   */
  public setSelection(from: EditorPosition, to?: EditorPosition): void {
    this.validatePosition(from);
    const actualTo = to || from;
    this.validatePosition(actualTo);

    this.selection = { anchor: from, head: actualTo };
    this.cursor = { ...actualTo };
    this.emit('selectionChange', this);
  }

  /**
   * Clear selection
   */
  public clearSelection(): void {
    this.selection = null;
    this.emit('selectionChange', this);
  }

  /**
   * Get word at position
   */
  public getWordAt(pos: EditorPosition): { anchor: EditorPosition; head: EditorPosition } | null {
    this.validatePosition(pos);
    const line = this.content[pos.line];
    const wordRegex = /\w+/g;
    let match;

    while ((match = wordRegex.exec(line)) !== null) {
      if (match.index <= pos.ch && match.index + match[0].length >= pos.ch) {
        return {
          anchor: { line: pos.line, ch: match.index },
          head: { line: pos.line, ch: match.index + match[0].length }
        };
      }
    }

    return null;
  }

  /**
   * Undo last change
   */
  public undo(): void {
    if (this.historyIndex >= 0) {
      const change = this.history[this.historyIndex];
      this.applyReverseChange(change);
      this.historyIndex--;
      this.emit('undo', this, change);
    }
  }

  /**
   * Redo last undone change
   */
  public redo(): void {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      const change = this.history[this.historyIndex];
      this.applyChange(change);
      this.emit('redo', this, change);
    }
  }

  /**
   * Check if undo is available
   */
  public canUndo(): boolean {
    return this.historyIndex >= 0;
  }

  /**
   * Check if redo is available
   */
  public canRedo(): boolean {
    return this.historyIndex < this.history.length - 1;
  }

  /**
   * Clear history
   */
  public clearHistory(): void {
    this.history = [];
    this.historyIndex = -1;
  }

  /**
   * Insert text at cursor
   */
  public insert(text: string): void {
    this.replaceRange(text, this.cursor);
    const newCursor = this.offsetPosition(this.cursor, text);
    this.setCursor(newCursor);
  }

  /**
   * Delete character at cursor
   */
  public deleteChar(): void {
    if (this.cursor.ch > 0) {
      const from = { line: this.cursor.line, ch: this.cursor.ch - 1 };
      this.replaceRange('', from, this.cursor);
      this.setCursor(from);
    } else if (this.cursor.line > 0) {
      const prevLine = this.cursor.line - 1;
      const prevLineLength = this.content[prevLine].length;
      const from = { line: prevLine, ch: prevLineLength };
      this.replaceRange('', from, this.cursor);
      this.setCursor(from);
    }
  }

  /**
   * Get editor focus state
   */
  public hasFocus(): boolean {
    // Mock implementation - always return true for testing
    return true;
  }

  /**
   * Focus the editor
   */
  public focus(): void {
    this.emit('focus', this);
  }

  /**
   * Blur the editor
   */
  public blur(): void {
    this.emit('blur', this);
  }

  /**
   * Convert position to offset
   */
  public posToOffset(pos: EditorPosition): number {
    this.validatePosition(pos);
    let offset = 0;

    for (let i = 0; i < pos.line; i++) {
      offset += this.content[i].length + 1; // +1 for newline
    }

    offset += pos.ch;
    return offset;
  }

  /**
   * Convert offset to position
   */
  public offsetToPos(offset: number): EditorPosition {
    let currentOffset = 0;

    for (let line = 0; line < this.content.length; line++) {
      const lineLength = this.content[line].length;

      if (currentOffset + lineLength >= offset) {
        return { line, ch: offset - currentOffset };
      }

      currentOffset += lineLength + 1; // +1 for newline
    }

    // Return last position if offset is beyond content
    const lastLine = this.content.length - 1;
    return { line: lastLine, ch: this.content[lastLine].length };
  }

  /**
   * Get editor state as object
   */
  public getEditorState(): any {
    return {
      content: this.content.slice(),
      cursor: { ...this.cursor },
      selection: this.selection ? { ...this.selection } : null,
      historyIndex: this.historyIndex,
      historyLength: this.history.length
    };
  }

  /**
   * Restore editor state
   */
  public restoreEditorState(state: any): void {
    this.content = state.content.slice();
    this.cursor = { ...state.cursor };
    this.selection = state.selection ? { ...state.selection } : null;
    this.historyIndex = state.historyIndex;
    this.emit('stateRestored', state);
  }

  /**
   * Validate position is within bounds
   */
  private validatePosition(pos: EditorPosition): void {
    if (pos.line < 0 || pos.line >= this.content.length) {
      throw new Error(`Line ${pos.line} out of bounds`);
    }
    if (pos.ch < 0 || pos.ch > this.content[pos.line].length) {
      throw new Error(`Character ${pos.ch} out of bounds for line ${pos.line}`);
    }
  }

  /**
   * Add change to history
   */
  private addToHistory(change: EditorChange): void {
    // Remove any history after current index (for redo functionality)
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(change);
    this.historyIndex++;
  }

  /**
   * Apply a change to the content
   */
  private applyChange(change: EditorChange): void {
    if (change.from.line === change.to.line) {
      const line = this.content[change.from.line];
      this.content[change.from.line] =
        line.substring(0, change.from.ch) +
        change.text.join('\n') +
        line.substring(change.to.ch);
    } else {
      const newContent = [
        ...this.content.slice(0, change.from.line),
        this.content[change.from.line].substring(0, change.from.ch) + change.text[0],
        ...change.text.slice(1, -1),
        change.text[change.text.length - 1] + this.content[change.to.line].substring(change.to.ch),
        ...this.content.slice(change.to.line + 1)
      ];
      this.content = newContent;
    }
  }

  /**
   * Apply reverse of a change (for undo)
   */
  private applyReverseChange(change: EditorChange): void {
    const reverseChange: EditorChange = {
      from: change.from,
      to: this.offsetPosition(change.from, change.text.join('\n')),
      text: change.removed,
      removed: change.text,
      origin: 'undo'
    };
    this.applyChange(reverseChange);
  }

  /**
   * Calculate new position after inserting text
   */
  private offsetPosition(pos: EditorPosition, text: string): EditorPosition {
    const lines = text.split('\n');
    if (lines.length === 1) {
      return { line: pos.line, ch: pos.ch + text.length };
    } else {
      return { line: pos.line + lines.length - 1, ch: lines[lines.length - 1].length };
    }
  }
}