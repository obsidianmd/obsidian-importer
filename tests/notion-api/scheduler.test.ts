import test from 'node:test';
import assert from 'node:assert/strict';

import {
	NotionRequestCoordinator,
	NotionRequestScheduler,
	watchForNotionOverload,
} from '../../src/formats/notion-api';

function scheduler() {
	let now = 0;
	const waits: number[] = [];
	const subject = new NotionRequestScheduler({
		rate: 2,
		burst: 2,
		now: () => now,
		sleep: async milliseconds => {
			waits.push(milliseconds);
			now += milliseconds;
		},
	});

	return { subject, waits };
}

test('the scheduler spends its burst before settling at the average rate', async () => {
	const { subject, waits } = scheduler();

	await subject.waitForTurn();
	await subject.waitForTurn();
	assert.deepEqual(waits, []);

	await subject.waitForTurn();
	assert.deepEqual(waits, [500]);
});

test('an overload drains the burst and applies a global cooldown', async () => {
	const { subject, waits } = scheduler();

	subject.overloaded(1000);
	await subject.waitForTurn();

	assert.deepEqual(waits, [1000, 500]);
});

test('the same credential keeps one scheduler across client initialization', () => {
	const coordinator = new NotionRequestCoordinator();
	const first = coordinator.forCredential('first');

	assert.equal(coordinator.forCredential('first'), first);
	assert.notEqual(coordinator.forCredential('second'), first);
});

test('a slow response switches the scheduler to its sustained rate without abandoning it', async () => {
	const { subject, waits } = scheduler();
	let resolve!: (value: string) => void;
	const request = new Promise<string>(done => resolve = done);
	let watchdog!: () => void;
	const cleared: number[] = [];
	let settled = false;
	const watched = watchForNotionOverload(request, subject, {
		set: callback => {
			watchdog = callback;
			return 7;
		},
		clear: timer => cleared.push(timer),
	});
	void watched.then(() => settled = true);

	watchdog();
	await Promise.resolve();
	assert.equal(settled, false);

	await subject.waitForTurn();
	assert.deepEqual(waits, [500]);

	resolve('finished');
	assert.equal(await watched, 'finished');
	assert.deepEqual(cleared, [7]);
});
