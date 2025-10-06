import type { PageObjectResponse, RichTextItemResponse } from '@notionhq/client/build/src/api-endpoints';
import * as fs from 'fs';
import * as path from 'path';

function extractPageTitle(page: PageObjectResponse): string {
	const properties = page.properties;

	for (const prop of Object.values(properties)) {
		if (typeof prop === 'object' && prop !== null && 'type' in prop && prop.type === 'title') {
			if ('title' in prop) {
				const titleValue = prop.title;
				if (Array.isArray(titleValue)) {
					const titleParts = (titleValue as RichTextItemResponse[])
						.filter(part => part.type === 'text' && 'text' in part && part.text?.content)
						.map(part => {
							if (part.type === 'text' && 'text' in part) {
								return part.text.content;
							}
							return '';
						});

					const result = titleParts.join('');
					if (result) {
						return result;
					}
				}
			}
		}
	}

	return 'Untitled';
}

console.log('=== Page Title Extraction Test Suite ===\n');

const mockDataDir = path.join(__dirname, 'mock-data');
const pagePath = path.join(mockDataDir, 'page-sample.json');

let passed = 0;
let failed = 0;

try {
	const pageData = JSON.parse(fs.readFileSync(pagePath, 'utf-8')) as PageObjectResponse;
	const title = extractPageTitle(pageData);
	const expected = 'Sample Task';

	if (title === expected) {
		console.log(`✅ Page title extraction`);
		console.log(`   Title: "${title}"`);
		passed++;
	} else {
		console.log(`❌ Page title extraction`);
		console.log(`   Expected: "${expected}"`);
		console.log(`   Got: "${title}"`);
		failed++;
	}
} catch (error) {
	console.log(`❌ Page title extraction`);
	console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
	failed++;
}

const pageNoTitle: PageObjectResponse = {
	object: 'page',
	id: 'test-123',
	created_time: '2024-01-01T00:00:00.000Z',
	last_edited_time: '2024-01-01T00:00:00.000Z',
	properties: {
		'Name': {
			id: 'title',
			type: 'title',
			title: []
		}
	}
} as any;

try {
	const title = extractPageTitle(pageNoTitle);
	const expected = 'Untitled';

	if (title === expected) {
		console.log(`✅ Page with no title (fallback to "Untitled")`);
		console.log(`   Title: "${title}"`);
		passed++;
	} else {
		console.log(`❌ Page with no title`);
		console.log(`   Expected: "${expected}"`);
		console.log(`   Got: "${title}"`);
		failed++;
	}
} catch (error) {
	console.log(`❌ Page with no title`);
	console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
	failed++;
}

const pageMultipleParts: PageObjectResponse = {
	object: 'page',
	id: 'test-456',
	created_time: '2024-01-01T00:00:00.000Z',
	last_edited_time: '2024-01-01T00:00:00.000Z',
	properties: {
		'Name': {
			id: 'title',
			type: 'title',
			title: [
				{
					type: 'text',
					text: { content: 'First ' },
					plain_text: 'First ',
					annotations: {
						bold: false,
						italic: false,
						strikethrough: false,
						underline: false,
						code: false,
						color: 'default'
					}
				},
				{
					type: 'text',
					text: { content: 'Second ' },
					plain_text: 'Second ',
					annotations: {
						bold: false,
						italic: false,
						strikethrough: false,
						underline: false,
						code: false,
						color: 'default'
					}
				},
				{
					type: 'text',
					text: { content: 'Third' },
					plain_text: 'Third',
					annotations: {
						bold: false,
						italic: false,
						strikethrough: false,
						underline: false,
						code: false,
						color: 'default'
					}
				}
			]
		}
	}
} as any;

try {
	const title = extractPageTitle(pageMultipleParts);
	const expected = 'First Second Third';

	if (title === expected) {
		console.log(`✅ Page with multiple title parts`);
		console.log(`   Title: "${title}"`);
		passed++;
	} else {
		console.log(`❌ Page with multiple title parts`);
		console.log(`   Expected: "${expected}"`);
		console.log(`   Got: "${title}"`);
		failed++;
	}
} catch (error) {
	console.log(`❌ Page with multiple title parts`);
	console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
	failed++;
}

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}/3`);
console.log(`Failed: ${failed}/3`);

if (failed === 0) {
	console.log('\n✅ All page title extraction tests passed!');
} else {
	console.log(`\n❌ ${failed} test(s) failed`);
}
