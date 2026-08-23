import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convertTasks } from '../../src/formats/logseq/tasks';

test('maps open Logseq task states to open checkboxes', () => {
	for (const state of ['TODO', 'LATER', 'WAITING', 'WAIT']) {
		assert.equal(convertTasks(`- ${state} task`), '- [ ] task');
	}
});

test('maps active Logseq task states to incomplete checkboxes', () => {
	for (const state of ['DOING', 'NOW', 'STARTED', 'IN-PROGRESS']) {
		assert.equal(convertTasks(`- ${state} task`), '- [/] task');
	}
});

test('maps completed and cancelled states to distinct checkboxes', () => {
	assert.equal(convertTasks('- DONE task'), '- [x] task');
	assert.equal(convertTasks('- CANCELLED task'), '- [-] task');
	assert.equal(convertTasks('- CANCELED task'), '- [-] task');
});

test('preserves indentation', () => {
	assert.equal(convertTasks('  - TODO x'), '  - [ ] x');
	assert.equal(convertTasks('\t\t- DONE y'), '\t\t- [x] y');
});

test('recognizes an optional colon after the task state', () => {
	assert.equal(convertTasks('- TODO: text'), '- [ ] text');
	assert.equal(convertTasks('- DONE: text'), '- [x] text');
});

test('does not touch non-task bullets or partial keywords', () => {
	assert.equal(convertTasks('- just text'), '- just text');
	assert.equal(convertTasks('- TODONT something'), '- TODONT something');
	assert.equal(convertTasks('plain TODO line'), 'plain TODO line');
});

test('turns priority and scheduling metadata into plain text and date links', () => {
	const input = [
		'- TODO [#A] do it SCHEDULED: <2024-09-10 Tue>',
		'  DEADLINE: <2024-09-15 Sun .+1d>',
		'  created:: 2024-01-15',
	].join('\n');
	assert.equal(convertTasks(input),
		'- [ ] do it \u2014 priority A, scheduled [[2024-09-10]], due [[2024-09-15]], created [[2024-01-15]], every day');
});

test('a task with no metadata gains no suffix', () => {
	assert.equal(convertTasks('- TODO plain thing'), '- [ ] plain thing');
});

test('a scheduled time of day survives beside its date link', () => {
	assert.equal(convertTasks('- TODO standup\n  SCHEDULED: <2024-09-10 Tue 09:30>'),
		'- [ ] standup \u2014 scheduled [[2024-09-10]] 09:30');
});

test('drops LOGBOOK drawers by default', () => {
	const input = [
		'- DONE x',
		'  :LOGBOOK:',
		'  CLOCK: [2024-08-07 Wed 11:47:50]--[2024-08-07 Wed 11:48:00] =>  00:00:10',
		'  :END:',
	].join('\n');
	assert.equal(convertTasks(input), '- [x] x');
});

test('keeps LOGBOOK drawers when configured', () => {
	const input = [
		'- DONE x',
		'  :LOGBOOK:',
		'  CLOCK: [2024-08-07 Wed 11:47:50]',
		'  :END:',
	].join('\n');
	assert.equal(convertTasks(input, { logbook: 'keep' }), input.replace('- DONE', '- [x]'));
});

test('drops LOGBOOK drawers attached to non-task blocks', () => {
	const input = [
		'- parent',
		'  - child',
		'    :LOGBOOK:',
		'    CLOCK: [2024-11-13 Wed 17:04:11]',
		'    :END:',
	].join('\n');
	assert.equal(convertTasks(input), ['- parent', '  - child'].join('\n'));
});

test('leaves task-like text and drawers inside code fences unchanged', () => {
	const input = ['```markdown', '- TODO example', ':LOGBOOK:', 'CLOCK: example', ':END:', '```'].join('\n');
	assert.equal(convertTasks(input), input);
});

test('handles task states without task text', () => {
	assert.equal(convertTasks('- TODO'), '- [ ]');
	assert.equal(convertTasks('- DONE'), '- [x]');
});
