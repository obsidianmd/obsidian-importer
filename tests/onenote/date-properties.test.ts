import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OnenotePage } from '@microsoft/microsoft-graph-types';

import {
	getOneNoteDateProperties,
	getOneNoteDateWriteOptions,
} from '../../src/formats/onenote/date-properties';

function page(overrides: Partial<OnenotePage>): OnenotePage {
	return overrides as OnenotePage;
}

test('maps OneNote created and updated dates to note properties', () => {
	const properties = getOneNoteDateProperties(page({
		createdDateTime: '2024-01-02T03:04:05Z',
		lastModifiedDateTime: '2024-02-03T04:05:06Z',
	}));

	assert.deepEqual(properties, {
		created: '2024-01-02T03:04:05.000Z',
		updated: '2024-02-03T04:05:06.000Z',
	});
});

test('omits date properties when OneNote dates are absent or invalid', () => {
	const properties = getOneNoteDateProperties(page({
		createdDateTime: 'not-a-date',
	}));

	assert.deepEqual(properties, {});
});

test('uses valid dates for Obsidian file write metadata', () => {
	const created = Date.parse('2024-01-02T03:04:05Z');
	const updated = Date.parse('2024-02-03T04:05:06Z');

	assert.deepEqual(getOneNoteDateWriteOptions(page({
		createdDateTime: '2024-01-02T03:04:05Z',
		lastModifiedDateTime: '2024-02-03T04:05:06Z',
	})), {
		ctime: created,
		mtime: updated,
	});
});

test('falls back to the valid OneNote date when the other date is invalid', () => {
	const updated = Date.parse('2024-02-03T04:05:06Z');

	assert.deepEqual(getOneNoteDateWriteOptions(page({
		createdDateTime: 'not-a-date',
		lastModifiedDateTime: '2024-02-03T04:05:06Z',
	})), {
		ctime: updated,
		mtime: updated,
	});
});
