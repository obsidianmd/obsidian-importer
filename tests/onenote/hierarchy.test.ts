import '../shims/runtime';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Notebook } from '@microsoft/microsoft-graph-types';

import { OneNoteImporter } from '../../src/formats/onenote';

test('a page path starts with its notebook and preserves section groups', () => {
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;
	subject.notebooks = [{
		id: 'notebook',
		displayName: 'Work',
		sectionGroups: [{
			id: 'group',
			displayName: 'Projects',
			sections: [{
				id: 'section',
				displayName: 'Roadmap',
				pages: [{ id: 'page', title: 'Next', level: 0, contentUrl: 'page-id=page}' }],
			}],
		}],
	}] as Notebook[];

	assert.equal(subject.getEntityPathNoParent('page', 'OneNote'), 'OneNote/Work/Projects/Roadmap');
});

/** A section whose pages descend three levels, as OneNote allows. */
function nestedSection() {
	const page = (id: string, title: string, level: number) =>
		({ id, title, level, contentUrl: `page-id=${id}}` });

	return [{
		id: 'notebook',
		displayName: 'Work',
		sections: [{
			id: 'section',
			displayName: 'Roadmap',
			pages: [
				page('top', 'Top', 0),
				page('sub', 'Sub', 1),
				page('subsub', 'SubSub', 2),
				page('back', 'Back to sub', 1),
				page('other', 'Another top', 0),
			],
		}],
	}] as Notebook[];
}

test('a subpage sits under every page above it, not just the nearest', () => {
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;
	subject.notebooks = nestedSection();

	const pathOf = (id: string) => subject.getEntityPathNoParent(id, 'OneNote');

	// A page with children of its own owns a folder named after it.
	assert.equal(pathOf('top'), 'OneNote/Work/Roadmap/Top');
	assert.equal(pathOf('sub'), 'OneNote/Work/Roadmap/Top');

	// The third level belongs under both of its ancestors. Keeping only the
	// nearest one moved it a level up, beside a folder it did not live in.
	assert.equal(pathOf('subsub'), 'OneNote/Work/Roadmap/Top/Sub');

	// A page returning to a shallower level goes back to that level's folder.
	assert.equal(pathOf('back'), 'OneNote/Work/Roadmap/Top');
	assert.equal(pathOf('other'), 'OneNote/Work/Roadmap');
});

test('a subpage whose own parent is missing stays under the page it follows', () => {
	const subject = Object.create(OneNoteImporter.prototype) as OneNoteImporter;
	const notebooks = nestedSection();

	// A second-level page with no first-level page above it: the parent was
	// deleted, and it must not reach back into the subtree before it.
	notebooks[0].sections![0].pages!.push(
		{ id: 'orphan', title: 'Orphan', level: 2, contentUrl: 'page-id=orphan}' } as never);
	subject.notebooks = notebooks;

	assert.equal(subject.getEntityPathNoParent('orphan', 'OneNote'), 'OneNote/Work/Roadmap/Another top');
});
