import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { Notice } from 'obsidian';
import type { ImporterData } from '../src/main';
import { OneNoteImporter } from '../src/formats/onenote';

// Polyfills to match Obsidian's runtime helpers
if (!(Array.prototype as any).contains) {
	// eslint-disable-next-line no-extend-native
	(Array.prototype as any).contains = function(value: any) {
		return this.includes(value);
	};
}

if (!(String.prototype as any).contains) {
	// eslint-disable-next-line no-extend-native
	(String.prototype as any).contains = function(value: string) {
		return this.includes(value);
	};
}

if (!(HTMLElement.prototype as any).findAll) {
	// eslint-disable-next-line no-extend-native
	(HTMLElement.prototype as any).findAll = function(selector: string) {
		return Array.from(this.querySelectorAll(selector));
	};
}


class TestableOneNoteImporter extends OneNoteImporter {
	init(): void {
		// Skip UI setup; the tests set state directly
		this.outputLocation = 'OneNote';
	}
}

interface TestHarness {
	importer: TestableOneNoteImporter;
	pluginData: ImporterData;
	root: string;
}

const createHarness = async (): Promise<TestHarness> => {
	const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'onenote-importer-'));
	const { Vault, App } = await import('obsidian');
	// @ts-ignore mocked class
	const vault = new Vault(root);
	// @ts-ignore mocked class
	const fileManager = new (await import('obsidian')).FileManager(vault);
	const app = new App(vault, fileManager);
	const pluginData: ImporterData = { importers: { onenote: { previouslyImportedIDs: [] } } };
	const plugin = {
		loadData: vi.fn().mockResolvedValue(pluginData),
		saveData: vi.fn(async (data: ImporterData) => Object.assign(pluginData, data)),
		registerAuthCallback: vi.fn(),
	};
	const modal = { contentEl: document.createElement('div'), plugin, abortController: new AbortController() } as any;
	const importer = new TestableOneNoteImporter(app as any, modal);
	importer.graphData.accessToken = 'token';
	return { importer, pluginData, root };
};

const createProgress = () => {
	return {
		status: vi.fn(),
		reportProgress: vi.fn(),
		reportSkipped: vi.fn(),
		reportFailed: vi.fn(),
		reportNoteSuccess: vi.fn(),
		reportAttachmentSuccess: vi.fn(),
		isCancelled: () => false,
	};
};

const buildMultipartContent = (html: string): string => {
	const boundary = '--batch_12345';
	return [
		`${boundary}`,
		'Content-Type: text/html; charset=utf-8',
		'',
		html,
		`${boundary}`,
		'Content-Type: application/inkml+xml',
		'',
		'<inkml></inkml>',
		'',
	].join('\n');
};

describe('OneNoteImporter integration', () => {
	let tmpRoot: string;

	beforeEach(() => {
		Notice.messages = [];
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		if (tmpRoot) {
			await fsp.rm(tmpRoot, { recursive: true, force: true });
		}
	});

	it('imports a simple page and writes markdown', async () => {
		const { importer, root } = await createHarness();
		tmpRoot = root;
		importer.selectedIds = ['section-1'];
		importer.notebooks = [
			{
				id: 'notebook-1',
				displayName: 'Test Notebook',
				sections: [
					{ id: 'section-1', displayName: 'Section A', pages: [] },
				],
			},
		] as any;

		const htmlBody = '<html><body><p>Hello OneNote</p></body></html>';
		const content = buildMultipartContent(htmlBody);

		const pagesResponse = {
			value: [
				{
					id: 'page-1',
					title: 'My Note',
					createdDateTime: '2023-01-01T00:00:00Z',
					lastModifiedDateTime: '2023-01-02T00:00:00Z',
					level: 0,
					order: 0,
					contentUrl: 'https://graph.microsoft.com/v1.0/me/onenote/pages/page-1/content?includeInkML=true',
				},
			],
		};

		const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
			const target = typeof url === 'string' ? url : url.toString();
			if (target.includes('/sections/section-1/pages')) {
				return new Response(JSON.stringify(pagesResponse), { status: 200 });
			}
			if (target.includes('/pages/page-1/content')) {
				return new Response(content, { status: 200 });
			}
			return new Response('not found', { status: 404 });
		});
		vi.stubGlobal('fetch', fetchMock as any);

		const progress = createProgress();
		await importer.import(progress as any);

		const notePath = path.join(root, 'OneNote', 'Test Notebook', 'Section A', 'My Note.md');
		const md = await fsp.readFile(notePath, 'utf8');
		expect(md).toContain('Hello OneNote');
		expect(progress.reportNoteSuccess).toHaveBeenCalledWith('My Note');
		expect(fetchMock).toHaveBeenCalled();
	});

	it('downloads attachments and rewrites embeds', async () => {
		const { importer, root } = await createHarness();
		tmpRoot = root;
		importer.selectedIds = ['section-2'];
		importer.notebooks = [
			{
				id: 'notebook-2',
				displayName: 'Work Notebook',
				sections: [
					{ id: 'section-2', displayName: 'Attachments', pages: [] },
				],
			},
		] as any;

		const htmlBody = [
			'<html><body>',
			'<object data-attachment="report.pdf" data="https://files.example.com/report.pdf"></object>',
			'<img data-fullres-src="https://files.example.com/photo" data-fullres-src-type="image/png" alt="Found via OCR" />',
			'</body></html>',
		].join('');
		const content = buildMultipartContent(htmlBody);

		const pagesResponse = {
			value: [
				{
					id: 'page-2',
					title: 'Page With Attachments',
					createdDateTime: '2023-01-01T00:00:00Z',
					lastModifiedDateTime: '2023-01-02T00:00:00Z',
					level: 0,
					order: 0,
					contentUrl: 'https://graph.microsoft.com/v1.0/me/onenote/pages/page-2/content?includeInkML=true',
				},
			],
		};

		const binaryBuffer = Buffer.from('file');
		const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
			const target = typeof url === 'string' ? url : url.toString();
			if (target.includes('/sections/section-2/pages')) {
				return new Response(JSON.stringify(pagesResponse), { status: 200 });
			}
			if (target.includes('/pages/page-2/content')) {
				return new Response(content, { status: 200 });
			}
			if (target.includes('report.pdf') || target.includes('photo')) {
				return new Response(binaryBuffer, { status: 200 });
			}
			return new Response('not found', { status: 404 });
		});
		vi.stubGlobal('fetch', fetchMock as any);

		const progress = createProgress();
		await importer.import(progress as any);

		const notePath = path.join(root, 'OneNote', 'Work Notebook', 'Attachments', 'Page With Attachments.md');
		const md = await fsp.readFile(notePath, 'utf8');
		const attachmentPath = path.join(root, 'OneNote', 'report.pdf');
		const imagePath = path.join(root, 'OneNote', 'Exported image 2023-01-01-000000-0.png');

		expect(fs.existsSync(attachmentPath)).toBe(true);
		expect(fs.existsSync(imagePath)).toBe(true);
		expect(md).toContain('![Found via OCR]');
		expect(progress.reportAttachmentSuccess).toHaveBeenCalledTimes(2);
	});
});
