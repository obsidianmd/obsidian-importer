import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fixNotionLists } from '../../src/formats/notion/lists';

class TestElement {
	tagName: string;
	children: TestElement[] = [];
	parentElement: TestElement | null = null;
	private attrs = new Map<string, string>();

	constructor(tagName: string, attrs: Record<string, string> = {}) {
		this.tagName = tagName.toUpperCase();
		for (const [key, value] of Object.entries(attrs)) {
			this.attrs.set(key, value);
		}
	}

	get ownerDocument() {
		return {
			createElement: (tagName: string) => new TestElement(tagName),
		};
	}

	get firstElementChild() {
		return this.children[0] ?? null;
	}

	get nextElementSibling() {
		if (!this.parentElement) return null;
		const index = this.parentElement.children.indexOf(this);
		return this.parentElement.children[index + 1] ?? null;
	}

	getAttribute(name: string) {
		return this.attrs.get(name) ?? null;
	}

	appendChild(child: TestElement) {
		child.remove();
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	replaceWith(replacement: TestElement) {
		if (!this.parentElement) return;
		const index = this.parentElement.children.indexOf(this);
		if (index === -1) return;
		replacement.parentElement = this.parentElement;
		this.parentElement.children[index] = replacement;
		this.parentElement = null;
	}

	remove() {
		if (!this.parentElement) return;
		const index = this.parentElement.children.indexOf(this);
		if (index !== -1) {
			this.parentElement.children.splice(index, 1);
		}
		this.parentElement = null;
	}

	querySelectorAll(tagName: string) {
		const matches: TestElement[] = [];
		const upperTagName = tagName.toUpperCase();
		const visit = (element: TestElement) => {
			for (const child of element.children) {
				if (child.tagName === upperTagName) {
					matches.push(child);
				}
				visit(child);
			}
		};
		visit(this);
		return matches;
	}
}

function el(tagName: string, attrs: Record<string, string> = {}, children: TestElement[] = []) {
	const element = new TestElement(tagName, attrs);
	for (const child of children) {
		element.appendChild(child);
	}
	return element;
}

function list(tagName: 'ul' | 'ol', listClass: string, items: string[]) {
	return el(tagName, { class: listClass }, items.map(item => el('li', { text: item })));
}

function displayContentsList(tagName: 'ul' | 'ol', listClass: string, items: string[]) {
	return el('div', { style: 'display:contents' }, [list(tagName, listClass, items)]);
}

function itemTexts(listElement: TestElement) {
	return listElement.children.map(child => child.getAttribute('text'));
}

test('merges Notion ordered lists wrapped in display contents divs', () => {
	const body = el('div', {}, [
		displayContentsList('ol', 'numbered-list', ['Item A']),
		displayContentsList('ol', 'numbered-list', ['Item B']),
		displayContentsList('ol', 'numbered-list', ['Item C']),
	]);

	fixNotionLists(body as unknown as HTMLElement, 'ol');

	assert.equal(body.children.length, 1);
	assert.equal(body.children[0].tagName, 'OL');
	assert.deepEqual(itemTexts(body.children[0]), ['Item A', 'Item B', 'Item C']);
});

test('keeps separate Notion list groups when classes differ across wrappers', () => {
	const body = el('div', {}, [
		displayContentsList('ol', 'numbered-list', ['Item A']),
		displayContentsList('ol', 'other-list', ['Item B']),
	]);

	fixNotionLists(body as unknown as HTMLElement, 'ol');

	assert.equal(body.children.length, 2);
	assert.deepEqual(itemTexts(body.children[0]), ['Item A']);
	assert.deepEqual(itemTexts(body.children[1]), ['Item B']);
});

test('still merges adjacent unwrapped Notion lists', () => {
	const body = el('div', {}, [
		list('ul', 'bulleted-list', ['Item A']),
		list('ul', 'bulleted-list', ['Item B']),
	]);

	fixNotionLists(body as unknown as HTMLElement, 'ul');

	assert.equal(body.children.length, 1);
	assert.equal(body.children[0].tagName, 'UL');
	assert.deepEqual(itemTexts(body.children[0]), ['Item A', 'Item B']);
});
