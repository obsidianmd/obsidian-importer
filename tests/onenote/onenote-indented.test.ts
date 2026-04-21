/**
 * Tests for the five nested-list and to-do cases in
 * onenote-indented-example.html, covering the bug where inner list items
 * and to-do items inside lists were silently dropped or escaped.
 *
 * Fixture structure:
 *   1. Indented Numbered List  – ol > li > p + ol > li > p + ol > li
 *   2. Indented Unordered List – ul > li > p + ul > li > p + ul > li
 *   3. Indented Numbered Todos – same structure with data-tag="to-do" on p/span
 *   4. Indented Unordered Todos – same structure with data-tag="to-do" on p/span
 *   5. Indented Todos – flat <p data-tag="to-do"> elements (no nesting in API output)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { convertFixture } from './helpers';

describe('onenote-indented-example.html – nested lists and todos', () => {
	let md: string;

	beforeEach(() => {
		md = convertFixture('onenote-indented-example.html');
	});

	// -----------------------------------------------------------------------
	// Case 1 – Indented Numbered List
	// -----------------------------------------------------------------------

	it('indented numbered list: outer items use "1." marker', () => {
		expect(md).toMatch(/1\.\s+Outer/);
	});

	it('indented numbered list: inner level-1 items are indented', () => {
		const outerIdx = md.indexOf('1.  Outer');
		const innerIdx = md.indexOf('Inner l1');
		expect(outerIdx).toBeGreaterThanOrEqual(0);
		expect(innerIdx).toBeGreaterThan(outerIdx);
		const innerLine = md.split('\n').find(line => line.includes('Inner l1'));
		expect(innerLine).toBeDefined();
		expect(innerLine!.match(/^\s+/)).not.toBeNull();
	});

	it('indented numbered list: inner level-2 items are more deeply indented', () => {
		const l1Line = md.split('\n').find(line => line.includes('Inner l1'));
		const l2Line = md.split('\n').find(line => line.includes('Inner l2'));
		expect(l1Line).toBeDefined();
		expect(l2Line).toBeDefined();
		const l1Indent = (l1Line!.match(/^\s+/) ?? [''])[0].length;
		const l2Indent = (l2Line!.match(/^\s+/) ?? [''])[0].length;
		expect(l2Indent).toBeGreaterThan(l1Indent);
	});

	// -----------------------------------------------------------------------
	// Case 2 – Indented Unordered List
	// -----------------------------------------------------------------------

	it('indented unordered list: outer items use "-" marker', () => {
		expect(md).toMatch(/-\s+Outer/);
	});

	it('indented unordered list: inner items are indented with "-"', () => {
		const innerLine = md.split('\n').find(line => line.includes('Inner 1'));
		expect(innerLine).toBeDefined();
		expect(innerLine!.match(/^\s+/)).not.toBeNull();
	});

	it('indented unordered list: deepest items are more deeply indented', () => {
		const l1Line = md.split('\n').find(line => line.includes('Inner 1'));
		const l2Line = md.split('\n').find(line => line.includes('Inner 2'));
		expect(l1Line).toBeDefined();
		expect(l2Line).toBeDefined();
		const l1Indent = (l1Line!.match(/^\s+/) ?? [''])[0].length;
		const l2Indent = (l2Line!.match(/^\s+/) ?? [''])[0].length;
		expect(l2Indent).toBeGreaterThan(l1Indent);
	});

	// -----------------------------------------------------------------------
	// Case 3 – Indented Numbered Todos
	// -----------------------------------------------------------------------

	it('indented numbered todos: outer items carry "[ ]" checkbox', () => {
		const numberedTodosStart = md.indexOf('Indented Numbered Todos');
		expect(numberedTodosStart).toBeGreaterThanOrEqual(0);
		const afterHeader = md.slice(numberedTodosStart);
		expect(afterHeader).toMatch(/\[ \]\s*Outer/);
	});

	it('indented numbered todos: nested items carry "[ ]" and are indented', () => {
		const afterHeader = md.slice(md.indexOf('Indented Numbered Todos'));
		const innerL1Line = afterHeader.split('\n').find(
			line => line.includes('[ ]') && line.includes('Inner l1')
		);
		expect(innerL1Line).toBeDefined();
		expect(innerL1Line!.match(/^\s+/)).not.toBeNull();
	});

	it('indented numbered todos: level-2 items have "[ ]" and deeper indentation', () => {
		const afterHeader = md.slice(md.indexOf('Indented Numbered Todos'));
		const innerL1Line = afterHeader.split('\n').find(
			line => line.includes('[ ]') && line.includes('Inner l1')
		);
		const innerL2Line = afterHeader.split('\n').find(
			line => line.includes('[ ]') && line.includes('Inner l2')
		);
		expect(innerL1Line).toBeDefined();
		expect(innerL2Line).toBeDefined();
		const l1Indent = (innerL1Line!.match(/^\s+/) ?? [''])[0].length;
		const l2Indent = (innerL2Line!.match(/^\s+/) ?? [''])[0].length;
		expect(l2Indent).toBeGreaterThan(l1Indent);
	});

	// -----------------------------------------------------------------------
	// Case 4 – Indented Unordered Todos
	// -----------------------------------------------------------------------

	it('indented unordered todos: outer items carry "[ ]" checkbox', () => {
		const unorderedTodosStart = md.indexOf('Indented Unordered Todos');
		expect(unorderedTodosStart).toBeGreaterThanOrEqual(0);
		const afterHeader = md.slice(unorderedTodosStart);
		expect(afterHeader).toMatch(/\[ \]\s*Outer/);
	});

	it('indented unordered todos: nested items carry "[ ]" and are indented', () => {
		const afterHeader = md.slice(md.indexOf('Indented Unordered Todos'));
		const innerL1Line = afterHeader.split('\n').find(
			line => line.includes('[ ]') && line.includes('Inner l1')
		);
		expect(innerL1Line).toBeDefined();
		expect(innerL1Line!.match(/^\s+/)).not.toBeNull();
	});

	it('indented unordered todos: level-2 items have "[ ]" and deeper indentation', () => {
		const afterHeader = md.slice(md.indexOf('Indented Unordered Todos'));
		const innerL1Line = afterHeader.split('\n').find(
			line => line.includes('[ ]') && line.includes('Inner l1')
		);
		const innerL2Line = afterHeader.split('\n').find(
			line => line.includes('[ ]') && line.includes('Inner l2')
		);
		expect(innerL1Line).toBeDefined();
		expect(innerL2Line).toBeDefined();
		const l1Indent = (innerL1Line!.match(/^\s+/) ?? [''])[0].length;
		const l2Indent = (innerL2Line!.match(/^\s+/) ?? [''])[0].length;
		expect(l2Indent).toBeGreaterThan(l1Indent);
	});

	// -----------------------------------------------------------------------
	// Case 5 – Flat "Indented" Todos
	// The OneNote API does not encode visual indentation for plain
	// <p data-tag="to-do"> elements — they are always flat in the HTML
	// regardless of how they appear in the UI.  All four items must become
	// top-level "- [ ]" task-list entries with no indentation.
	// -----------------------------------------------------------------------

	it('flat todos: each <p data-tag="to-do"> becomes a "- [ ]" task-list item', () => {
		const flatTodosStart = md.indexOf('Indented Todos');
		expect(flatTodosStart).toBeGreaterThanOrEqual(0);
		const afterHeader = md.slice(flatTodosStart);
		const taskLines = afterHeader.split('\n').filter(line => line.includes('[ ]'));
		// Four flat todo items in the fixture
		expect(taskLines.length).toBeGreaterThanOrEqual(4);
		// None should be escaped (no backslash before the brackets)
		for (const line of taskLines) {
			expect(line).not.toMatch(/\\\[/);
		}
	});

	it('flat todos: items appear at the top level (no leading indentation)', () => {
		const afterHeader = md.slice(md.indexOf('Indented Todos'));
		const taskLines = afterHeader
			.split('\n')
			.filter(line => line.includes('[ ]') && line.trim() !== '');
		for (const line of taskLines) {
			expect(line.startsWith(' ')).toBe(false);
		}
	});
});
