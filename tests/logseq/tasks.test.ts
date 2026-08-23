import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convertTasks } from '../../src/formats/logseq/tasks';

// --- state mapping (emoji) ---
test('maps Logseq task states to checkboxes (emoji)', () => {
	assert.equal(convertTasks('- TODO a', 'tasks-emoji'), '- [ ] a');
	assert.equal(convertTasks('- LATER e', 'tasks-emoji'), '- [ ] e');
	assert.equal(convertTasks('- DOING b', 'tasks-emoji'), '- [/] b');
	assert.equal(convertTasks('- NOW f', 'tasks-emoji'), '- [/] f');
	assert.equal(convertTasks('- DONE c', 'tasks-emoji'), '- [x] c');
	assert.equal(convertTasks('- CANCELLED d', 'tasks-emoji'), '- [-] d');
	assert.equal(convertTasks('- WAITING g', 'tasks-emoji'), '- [ ] g');
});

test('preserves indentation', () => {
	assert.equal(convertTasks('  - TODO x', 'tasks-emoji'), '  - [ ] x');
	assert.equal(convertTasks('\t\t- DONE y', 'tasks-emoji'), '\t\t- [x] y');
});

test('does not touch non-task bullets or partial keywords', () => {
	assert.equal(convertTasks('- just text', 'tasks-emoji'), '- just text');
	assert.equal(convertTasks('- TODONT something', 'tasks-emoji'), '- TODONT something');
	assert.equal(convertTasks('plain TODO line', 'tasks-emoji'), 'plain TODO line');
});

// --- D1: colon-style keyword tasks ---
test('[D1] - TODO: text is recognized and the colon is dropped', () => {
	assert.equal(convertTasks('- TODO: text', 'tasks-emoji'), '- [ ] text');
});

test('[D1] - DONE: text', () => {
	assert.equal(convertTasks('- DONE: text', 'tasks-emoji'), '- [x] text');
});

test('[D1] - WAITING: text', () => {
	assert.equal(convertTasks('- WAITING: text', 'tasks-emoji'), '- [ ] text');
});

test('[D1] partial keyword TODOX is still not a task', () => {
	assert.equal(convertTasks('- TODOX foo', 'tasks-emoji'), '- TODOX foo');
});

// --- priority ---
test('converts priority markers (emoji)', () => {
	assert.equal(convertTasks('- TODO [#A] x', 'tasks-emoji'), '- [ ] x ⏫');
	assert.equal(convertTasks('- TODO [#B] x', 'tasks-emoji'), '- [ ] x 🔼');
	assert.equal(convertTasks('- TODO [#C] x', 'tasks-emoji'), '- [ ] x 🔽');
});

test('converts priority markers (dataview)', () => {
	assert.equal(convertTasks('- TODO [#A] x', 'tasks-dataview'), '- [ ] x [priority:: high]');
});

// --- scheduled / deadline on continuation lines ---
test('scheduled date on continuation line (emoji)', () => {
	const input = ['- TODO do it', '  SCHEDULED: <2024-09-10 Tue>'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [ ] do it ⏳ 2024-09-10');
});

test('deadline with repeater (emoji)', () => {
	const input = ['- TODO pay', '  DEADLINE: <2024-09-15 Sun .+1d>'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [ ] pay 📅 2024-09-15 🔁 every day when done');
});

test('deadline with multi-unit repeater (emoji)', () => {
	const input = ['- TODO chore', '  SCHEDULED: <2024-09-15 Sun ++2w>'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [ ] chore ⏳ 2024-09-15 🔁 every 2 weeks when done');
});

test('scheduled date (dataview)', () => {
	const input = ['- TODO do it', '  SCHEDULED: <2024-09-10 Tue>'].join('\n');
	assert.equal(convertTasks(input, 'tasks-dataview'), '- [ ] do it [scheduled:: 2024-09-10]');
});

// --- task date properties ---
test('completed property becomes done emoji', () => {
	const input = ['- DONE finish', '  completed:: [[2024-04-10]]'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [x] finish ✅ 2024-04-10');
});

test('created property becomes plus emoji', () => {
	const input = ['- TODO start', '  created:: 2024-01-15'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [ ] start ➕ 2024-01-15');
});

test('done property (dataview)', () => {
	const input = ['- DONE finish', '  completed:: 2024-04-10'].join('\n');
	assert.equal(convertTasks(input, 'tasks-dataview'), '- [x] finish [completion:: 2024-04-10]');
});

// --- ordering: priority before dates ---
test('priority precedes scheduled metadata', () => {
	const input = ['- TODO [#A] do', '  SCHEDULED: <2024-09-10 Tue>'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [ ] do ⏫ ⏳ 2024-09-10');
});

// --- LOGBOOK ---
test('drops LOGBOOK drawer by default', () => {
	const input = [
		'- DONE x',
		'  :LOGBOOK:',
		'  CLOCK: [2024-08-07 Wed 11:47:50]--[2024-08-07 Wed 11:48:00] =>  00:00:10',
		'  :END:',
	].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji', { logbook: 'drop' }), '- [x] x');
});

test('keeps LOGBOOK drawer when configured', () => {
	const input = [
		'- DONE x',
		'  :LOGBOOK:',
		'  CLOCK: [2024-08-07 Wed 11:47:50]',
		'  :END:',
	].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji', { logbook: 'keep' }), input.replace('- DONE x', '- [x] x'));
});

// --- plain format ---
test('plain format only converts the state keyword', () => {
	assert.equal(convertTasks('- DOING [#A] x', 'plain'), '- [ ] [#A] x');
	assert.equal(convertTasks('- CANCELLED y', 'plain'), '- [x] y');
	const input = ['- TODO do it', '  SCHEDULED: <2024-09-10 Tue>'].join('\n');
	// scheduled line is left as-is in plain mode
	assert.equal(convertTasks(input, 'plain'), ['- [ ] do it', '  SCHEDULED: <2024-09-10 Tue>'].join('\n'));
});

// --- non-task content with child bullets is untouched ---
test('child bullets are not consumed as task continuation', () => {
	const input = ['- TODO parent', '  - child block', '  - second child'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), ['- [ ] parent', '  - child block', '  - second child'].join('\n'));
});

// --- additional state variations ---
test('WAIT state maps to open checkbox (emoji)', () => {
	assert.equal(convertTasks('- WAIT for approval', 'tasks-emoji'), '- [ ] for approval');
});

test('IN-PROGRESS state maps to open checkbox (emoji)', () => {
	assert.equal(convertTasks('- IN-PROGRESS refactoring', 'tasks-emoji'), '- [ ] refactoring');
});

test('CANCELED (single L) maps to cancelled (emoji)', () => {
	assert.equal(convertTasks('- CANCELED old item', 'tasks-emoji'), '- [-] old item');
});

// --- combined SCHEDULED + DEADLINE ---
test('task with both SCHEDULED and DEADLINE (emoji)', () => {
	const input = ['- TODO both', '  SCHEDULED: <2024-09-01 Sun>', '  DEADLINE: <2024-09-15 Mon>'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [ ] both ⏳ 2024-09-01 📅 2024-09-15');
});

test('task with both SCHEDULED and DEADLINE (dataview)', () => {
	const input = ['- TODO both', '  SCHEDULED: <2024-09-01 Sun>', '  DEADLINE: <2024-09-15 Mon>'].join('\n');
	assert.equal(convertTasks(input, 'tasks-dataview'), '- [ ] both [scheduled:: 2024-09-01] [due:: 2024-09-15]');
});

// --- DEADLINE with repeater (dataview) ---
test('deadline with repeater (dataview)', () => {
	const input = ['- TODO chore', '  DEADLINE: <2024-09-15 Sun .+2w>'].join('\n');
	assert.equal(convertTasks(input, 'tasks-dataview'), '- [ ] chore [due:: 2024-09-15] [repeat:: .+2w]');
});

// --- edge: empty task text ---
test('task keyword with no text', () => {
	assert.equal(convertTasks('- TODO', 'tasks-emoji'), '- [ ]');
	assert.equal(convertTasks('- DONE', 'tasks-emoji'), '- [x]');
});

// --- completed + created combined ---
test('completed and created on same task (emoji)', () => {
	const input = ['- DONE finish', '  created:: 2024-01-01', '  completed:: 2024-06-15'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [x] finish ➕ 2024-01-01 ✅ 2024-06-15');
});

// --- cancelled date property ---
test('cancelled property with wikilink date (emoji)', () => {
	const input = ['- CANCELLED nope', '  cancelled:: [[2024-03-20]]'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [-] nope ❌ 2024-03-20');
});

// ---------------------------------------------------------------------------
// Documented transformation cases — D1.
// ---------------------------------------------------------------------------

// D1: Logseq long-date format must normalize to ISO in task metadata.
test('[D1] completed date in Logseq long-date format normalizes to ISO (emoji)', () => {
	const input = ['- DONE x', '  completed:: [[Feb 13th, 2025]]'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [x] x ✅ 2025-02-13');
});

// --- D1: Logseq set-literal completed:: #{…} ---
test('[D1] completed:: #{"Mar 3rd, 2025"} becomes ✅ 2025-03-03', () => {
	const input = ['- DONE x', '  completed:: #{"Mar 3rd, 2025"}'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [x] x ✅ 2025-03-03');
});

test('[D1] malformed completed:: #{"{"} emits no completion date and drops cleanly', () => {
	const input = ['- DONE x', '  completed:: #{"{"}'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [x] x');
});

// D1: a LOGBOOK/CLOCK drawer on a NON-task bullet must still be dropped.
test('[D1] drops LOGBOOK drawer attached to a non-task child bullet', () => {
	const input = [
		'- DONE parent',
		'\t- plain child',
		'\t  :LOGBOOK:',
		'\t  CLOCK: [2024-11-13 Wed 17:04:11]--[2024-11-13 Wed 17:04:12] =>  00:00:01',
		'\t  :END:',
	].join('\n');
	assert.equal(
		convertTasks(input, 'tasks-emoji', { logbook: 'drop' }),
		['- [x] parent', '\t- plain child'].join('\n'),
	);
});

// D1: a blank/whitespace-only continuation line must not orphan metadata.
test('[D1] metadata after a blank continuation line is still parsed (emoji)', () => {
	const input = ['- DONE x', '  ', '  SCHEDULED: <2024-11-06 Wed>', '  ', '  completed:: 2024-11-06'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [x] x ⏳ 2024-11-06 ✅ 2024-11-06');
});

// D1 (guard): time-of-day in SCHEDULED is intentionally dropped to date-only.
test('[D1] time-of-day in SCHEDULED is dropped to date-only (emoji)', () => {
	const input = ['- TODO meet', '  SCHEDULED: <2025-02-20 Thu 14:00>'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [ ] meet ⏳ 2025-02-20');
});

// D1: an unparsable template-token date must not be emitted as a ➕ date.
test('[D1] template token in created date is not emitted as a plus-date (emoji)', () => {
	const input = ['- TODO x', '  created:: [[{{date:YYYY-MM-DD}}]]'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [ ] x');
});

test('inline code in a task does not orphan its metadata', () => {
	const input = ['- TODO update `README.md`', '  SCHEDULED: <2024-06-15 Sat>'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [ ] update `README.md` ⏳ 2024-06-15');
});

test('task-like text after inline code is not treated as a line start', () => {
	const input = 'Prose `x` - TODO not a task';
	assert.equal(convertTasks(input, 'tasks-emoji'), input);
});

// Logseq writes SCHEDULED/DEADLINE on a continuation line, but a hand-edited
// graph can leave one inline, where it used to survive as raw org syntax.
test('an inline SCHEDULED becomes a Tasks field', () => {
	assert.equal(
		convertTasks('- TODO buy milk SCHEDULED: <2024-06-15 Sat>', 'tasks-emoji'),
		'- [ ] buy milk ⏳ 2024-06-15');
});

test('an inline DEADLINE becomes a Tasks field', () => {
	assert.equal(
		convertTasks('- TODO ship it DEADLINE: <2024-07-01 Mon>', 'tasks-emoji'),
		'- [ ] ship it 📅 2024-07-01');
});

test('an inline SCHEDULED and DEADLINE are both taken, scheduled first', () => {
	assert.equal(
		convertTasks('- TODO x SCHEDULED: <2024-06-15 Sat> DEADLINE: <2024-07-01 Mon>', 'tasks-emoji'),
		'- [ ] x ⏳ 2024-06-15 📅 2024-07-01');
});

test('an inline repeater is carried across', () => {
	assert.equal(
		convertTasks('- TODO water plants SCHEDULED: <2024-06-15 Sat .+3d>', 'tasks-emoji'),
		'- [ ] water plants ⏳ 2024-06-15 🔁 every 3 days when done');
});

test('an inline SCHEDULED renders as a Dataview field too', () => {
	assert.equal(
		convertTasks('- TODO x SCHEDULED: <2024-06-15 Sat>', 'tasks-dataview'),
		'- [ ] x [scheduled:: 2024-06-15]');
});

// The continuation line is the canonical form, so it wins where a task has both.
test('a continuation SCHEDULED overrides an inline one', () => {
	const input = ['- TODO x SCHEDULED: <2024-01-01 Mon>', '  SCHEDULED: <2024-06-15 Sat>'].join('\n');
	assert.equal(convertTasks(input, 'tasks-emoji'), '- [ ] x ⏳ 2024-06-15');
});

// `plain` flattens metadata into the text rather than reading it.
test('plain format leaves an inline SCHEDULED in the text', () => {
	assert.equal(
		convertTasks('- TODO x SCHEDULED: <2024-06-15 Sat>', 'plain'),
		'- [ ] x SCHEDULED: <2024-06-15 Sat>');
});

// Only the task's own metadata is taken; prose that merely mentions it is not.
test('SCHEDULED in a non-task bullet is left alone', () => {
	const input = '- The SCHEDULED: <2024-06-15 Sat> syntax marks a date';
	assert.equal(convertTasks(input, 'tasks-emoji'), input);
});
