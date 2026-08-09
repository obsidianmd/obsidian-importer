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
