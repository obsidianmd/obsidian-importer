/**
 * Pausing an import: what shouldStop() does while paused, and - the one that
 * would otherwise be found in an import that never ends - when a paused import
 * is then stopped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ImportContext } from '../../src/import-context';

/** An importer's loop, reporting each item it gets through. */
function runImport(ctx: ImportContext, items: number): { done: string[], finished: Promise<void> } {
	const done: string[] = [];

	const finished = (async () => {
		for (let i = 1; i <= items; i++) {
			if (await ctx.shouldStop()) return;
			done.push(`item ${i}`);
		}
	})();

	return { done, finished };
}

/** Let anything already resolved run. */
function settle(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

test('an import goes on until it runs out of items', async () => {
	const ctx = new ImportContext();
	const { done, finished } = runImport(ctx, 3);

	await finished;
	assert.deepEqual(done, ['item 1', 'item 2', 'item 3']);
});

test('a paused import stops at its next checkpoint, and goes on when resumed', async () => {
	const ctx = new ImportContext();
	const { done, finished } = runImport(ctx, 3);

	ctx.pause();
	await settle();

	assert.equal(ctx.isPaused(), true);
	assert.deepEqual(done, ['item 1'], 'the item in hand is finished, the next one is not started');

	await settle();
	assert.deepEqual(done, ['item 1']);

	ctx.resume();
	await finished;

	assert.equal(ctx.isPaused(), false);
	assert.deepEqual(done, ['item 1', 'item 2', 'item 3']);
});

// With a timeout: the failure this catches would otherwise hang the run
// rather than fail it.
test('a paused import can still be stopped', { timeout: 2000 }, async () => {
	const ctx = new ImportContext();
	const { done, finished } = runImport(ctx, 100);

	ctx.pause();
	await settle();

	// It has to be let go of the checkpoint to find out that it should stop
	ctx.cancel();
	await finished;

	assert.deepEqual(done, ['item 1']);
	assert.equal(ctx.isPaused(), false, 'a cancelled import is not left paused');
});

test('an import already stopped does not pause', async () => {
	const ctx = new ImportContext();
	ctx.cancel();
	ctx.pause();

	assert.equal(ctx.isPaused(), false);
	assert.equal(await ctx.shouldStop(), true);
});

test('resuming an import that was not paused does nothing', async () => {
	const ctx = new ImportContext();
	const { done, finished } = runImport(ctx, 2);

	ctx.resume();
	await finished;

	assert.deepEqual(done, ['item 1', 'item 2']);
});

test('the dialog is told when the pause goes on and comes off', async () => {
	const seen: boolean[] = [];
	class Reporting extends ImportContext {
		protected onPaused(paused: boolean): void {
			seen.push(paused);
		}
	}

	const ctx = new Reporting();
	ctx.pause();
	ctx.pause();
	ctx.resume();
	ctx.resume();

	assert.deepEqual(seen, [true, false], 'said once each way, not once per press');
});

// Timed out for the same reason as the one above
test('a pause lifted and put back on holds the import again', { timeout: 2000 }, async () => {
	const ctx = new ImportContext();
	const { done, finished } = runImport(ctx, 4);

	ctx.pause();
	await settle();
	assert.deepEqual(done, ['item 1']);

	// Lifted and put back on before the import gets a turn: it wakes, finds the
	// pause on again, and has to arm a fresh waiter for the resume() below
	ctx.resume();
	ctx.pause();
	await settle();
	assert.deepEqual(done, ['item 1'], 'still held, not run on');

	ctx.resume();
	await finished;
	assert.deepEqual(done, ['item 1', 'item 2', 'item 3', 'item 4']);
});

test('reaching a checkpoint is counted', async () => {
	const ctx = new ImportContext();
	assert.equal(ctx.checkpoints, 0, 'nothing asked yet');

	const { finished } = runImport(ctx, 3);
	await finished;

	assert.equal(ctx.checkpoints, 3);
});

test('asking whether it was cancelled is not reaching a checkpoint', async () => {
	const ctx = new ImportContext();

	// What the dialog itself calls: counting it would make every importer
	// look interruptible
	ctx.isCancelled();
	ctx.isCancelled();

	assert.equal(ctx.checkpoints, 0);
});
