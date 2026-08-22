import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TreePicker, ViewableNode } from '../../src/tree-view';

interface Node extends ViewableNode<Node> {
	title: string;
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});

	return { promise, resolve, reject };
}

function node(title: string): Node {
	return { title, selected: true, disabled: false };
}

function picker(): TreePicker<Node> {
	const buttonEl = { hide() {}, show() {} };
	const statusEl = {
		text: '',
		visible: false,
		setText(value: string) { this.text = value; return this; },
		hide() { this.visible = false; },
		show() { this.visible = true; },
		toggle(value: boolean) { this.visible = value; },
	};
	const loadButton = {
		buttonEl,
		disabled: false,
		setDisabled(value: boolean) { this.disabled = value; return this; },
		setButtonText() { return this; },
	};
	const subject = Object.create(TreePicker.prototype) as TreePicker<Node>;
	const internals = subject as unknown as Record<string, unknown>;

	Object.assign(internals, {
		nodes: [],
		loadGeneration: 0,
		toggleButton: { buttonEl },
		loadButton,
		statusEl,
		statusText: '',
		options: { loading: 'Loading', hint: 'Pick one', failed: () => 'Failed' },
		clearFilter() {},
	});
	subject.setStatus = () => {};
	subject.render = () => {};

	return subject;
}

test('a completed load cannot overwrite the load that replaced it', async () => {
	const subject = picker();
	const slow = deferred<void>();
	let stillCurrent = true;

	const first = subject.load(async isCurrent => {
		await slow.promise;
		stillCurrent = isCurrent();
		return [node('old')];
	});
	await subject.load(async () => [node('new')]);

	slow.resolve();
	await first;

	assert.equal(stillCurrent, false);
	assert.deepEqual(subject.nodes.map(item => item.title), ['new']);
});

test('a load can publish usable nodes before it completes', async () => {
	const subject = picker();
	const seen: string[][] = [];
	subject.render = () => seen.push(subject.nodes.map(item => item.title));

	await subject.load(async (_isCurrent, publish) => {
		publish([node('first page')]);
		assert.deepEqual(subject.nodes.map(item => item.title), ['first page']);
		publish([node('first page'), node('second page')]);
		return [node('complete')];
	});

	assert.deepEqual(seen, [
		['first page'],
		['first page', 'second page'],
		['complete'],
	]);
});

test('a status remains above partial nodes until loading completes', async () => {
	const subject = picker();
	const internals = subject as unknown as {
		statusEl: { text: string; visible: boolean };
		statusText: string;
	};

	subject.setStatus = (text: string) => {
		internals.statusText = text;
		(TreePicker.prototype as unknown as { updateStatusPosition(this: TreePicker<Node>): void })
			.updateStatusPosition.call(subject);
	};

	await subject.load(async (_isCurrent, publish) => {
		publish([node('first page')]);
		subject.setStatus('Loading page 2');
		assert.equal(internals.statusEl.visible, true);
		assert.equal(internals.statusEl.text, 'Loading page 2');
		return [node('complete')];
	});

	assert.equal(internals.statusEl.visible, false);
});

test('a stale load cannot publish partial nodes', async () => {
	const subject = picker();
	const slow = deferred<void>();

	const first = subject.load(async (_isCurrent, publish) => {
		await slow.promise;
		publish([node('stale partial')]);
		return [node('stale complete')];
	});
	await subject.load(async () => [node('new')]);

	slow.resolve();
	await first;

	assert.deepEqual(subject.nodes.map(item => item.title), ['new']);
});

test('reset invalidates a load still in progress', async () => {
	const subject = picker();
	const slow = deferred<void>();

	const loading = subject.load(async () => {
		await slow.promise;
		return [node('late')];
	});
	subject.reset();
	const loadButton = (subject as unknown as { loadButton: { disabled: boolean } }).loadButton;

	slow.resolve();
	await loading;

	assert.deepEqual(subject.nodes, []);
	assert.equal(loadButton.disabled, false);
});

test('a rejected stale load does not replace the current state with an error', async () => {
	const subject = picker();
	const slow = deferred<void>();

	const first = subject.load(async () => {
		await slow.promise;
		throw new Error('old failure');
	});
	await subject.load(async () => [node('new')]);

	slow.resolve();
	await first;

	assert.deepEqual(subject.nodes.map(item => item.title), ['new']);
});
