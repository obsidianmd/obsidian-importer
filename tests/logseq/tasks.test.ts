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
		'- [ ] do it \u2014 priority A, scheduled [[2024-09-10]], due [[2024-09-15]] every day (.+1d), created [[2024-01-15]]');
});

test('a task with no metadata gains no suffix', () => {
	assert.equal(convertTasks('- TODO plain thing'), '- [ ] plain thing');
});

test('a scheduled time of day survives beside its date link', () => {
	assert.equal(convertTasks('- TODO standup\n  SCHEDULED: <2024-09-10 Tue 09:30>'),
		'- [ ] standup \u2014 scheduled [[2024-09-10]] 09:30');
});

test('preserves each repeater and its Logseq mode', () => {
	const input = [
		'- TODO recurring',
		'  SCHEDULED: <2024-09-10 Tue +1d>',
		'  DEADLINE: <2024-09-15 Sun ++2w>',
	].join('\n');
	assert.equal(convertTasks(input),
		'- [ ] recurring \u2014 scheduled [[2024-09-10]] every day (+1d), due [[2024-09-15]] every 2 weeks (++2w)');
});

test('preserves inline scheduling that cannot be parsed', () => {
	const input = '- TODO prepare SCHEDULED: <{{date:YYYY-MM-DD}}>';
	assert.equal(convertTasks(input), '- [ ] prepare SCHEDULED: <{{date:YYYY-MM-DD}}>');
});

test('preserves continuation metadata that cannot be parsed', () => {
	const input = [
		'- TODO prepare',
		'  DEADLINE: <someday>',
		'  created:: [[{{date:YYYY-MM-DD}}]]',
		'  completed:: #{"{"}',
	].join('\n');
	assert.equal(convertTasks(input), [
		'- [ ] prepare',
		'  DEADLINE: <someday>',
		'  created:: [[{{date:YYYY-MM-DD}}]]',
		'  completed:: #{"{"}',
	].join('\n'));
});

test('keeps an existing block anchor after generated metadata', () => {
	assert.equal(
		convertTasks('- TODO anchored SCHEDULED: <2024-09-10 Tue> ^abc123'),
		'- [ ] anchored \u2014 scheduled [[2024-09-10]] ^abc123',
	);
});

test('continuation scheduling overrides inline scheduling', () => {
	const input = [
		'- TODO changed SCHEDULED: <2024-01-01 Mon>',
		'  SCHEDULED: <2024-06-15 Sat>',
	].join('\n');
	assert.equal(convertTasks(input), '- [ ] changed \u2014 scheduled [[2024-06-15]]');
});

test('leaves scheduling syntax inside inline code unchanged', () => {
	const input = '- TODO document `SCHEDULED: <2024-06-15 Sat>` literally';
	assert.equal(convertTasks(input), '- [ ] document `SCHEDULED: <2024-06-15 Sat>` literally');
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
	assert.equal(convertTasks(input, true), input.replace('- DONE', '- [x]'));
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
