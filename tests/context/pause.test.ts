/**
 * Pausing an import, which is the dialog holding it at a checkpoint.
 *
 * The importers ask ImportContext.shouldStop() between one item and the next.
 * Nothing else in the codebase makes an import wait, so what that call does
 * while paused - and, more importantly, what it does when the paused import is
 * then stopped - is worth pinning down here rather than finding in an import
 * that will not end.
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

/** Let anything already resolved run, without deciding how many turns that takes. */
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

	// However long it is left there
	await settle();
	assert.deepEqual(done, ['item 1']);

	ctx.resume();
	await finished;

	assert.equal(ctx.isPaused(), false);
	assert.deepEqual(done, ['item 1', 'item 2', 'item 3']);
});

// With a timeout, because the failure this is here to catch is an import that
// waits for a pause nobody is going to lift. Without one it hangs the run
// instead of failing it.
test('a paused import can still be stopped', { timeout: 2000 }, async () => {
	const ctx = new ImportContext();
	const { done, finished } = runImport(ctx, 100);

	ctx.pause();
	await settle();

	// Stop, with the import waiting at a checkpoint: it has to be let go to
	// find out that it should stop, or the import never ends
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

// With a timeout for the same reason as the one above: a re-arm that goes wrong
// leaves the import waiting on a promise nothing will resolve.
test('a pause lifted and put back on holds the import again', { timeout: 2000 }, async () => {
	const ctx = new ImportContext();
	const { done, finished } = runImport(ctx, 4);

	ctx.pause();
	await settle();
	assert.deepEqual(done, ['item 1']);

	// Lifted and put back on before the import is given a turn. It is woken and
	// finds the pause on again, so it stays at the checkpoint it reached - and
	// the waiter resume() cleared has to have been replaced by a fresh one, or
	// the resume() below is a wake nothing is listening for.
	ctx.resume();
	ctx.pause();
	await settle();
	assert.deepEqual(done, ['item 1'], 'still held, not run on');

	ctx.resume();
	await finished;
	assert.deepEqual(done, ['item 1', 'item 2', 'item 3', 'item 4']);
});

/*
 * The count the dialog checks its own promise against: it draws Pause and Stop
 * for an importer that says it honours them, and warns if the import then
 * finished without ever reaching a checkpoint.
 */

test('reaching a checkpoint is counted', async () => {
	const ctx = new ImportContext();
	assert.equal(ctx.checkpoints, 0, 'nothing asked yet');

	const { finished } = runImport(ctx, 3);
	await finished;

	assert.equal(ctx.checkpoints, 3);
});

test('asking whether it was cancelled is not reaching a checkpoint', async () => {
	const ctx = new ImportContext();

	// What the dialog itself calls, on an import that never asks. Counting it
	// would report every importer as interruptible and the warning would never
	// fire, which is the whole reason the count exists.
	ctx.isCancelled();
	ctx.isCancelled();

	assert.equal(ctx.checkpoints, 0);
});
