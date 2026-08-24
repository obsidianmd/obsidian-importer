import test from 'node:test';
import assert from 'node:assert/strict';

import { NotionRequestScheduler } from '../../src/formats/notion-api';

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

test('a slow response switches the scheduler to its sustained rate', async () => {
	const { subject, waits } = scheduler();

	subject.requestCompleted(2000);
	await subject.waitForTurn();

	assert.deepEqual(waits, [500]);
});
