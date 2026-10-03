import '../shims/dom';
import '../shims/runtime';

import assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import * as nodeZlib from 'node:zlib';
import { afterEach, test } from 'node:test';
import { resolveObjectURL } from 'node:buffer';

import { Platform } from 'obsidian';

import { FormatImporter, NoteTemplateSample, TEMPLATE_PREVIEW_LIMIT } from '../../src/format-importer';
import { NodePickedFile, provideNodeModules } from '../../src/filesystem';
import { Bear2bkImporter } from '../../src/formats/bear-bear2bk';
import { EvernoteEnexImporter } from '../../src/formats/evernote-enex';
import { NotionImporter } from '../../src/formats/notion';
import { OneNoteFileImporter } from '../../src/formats/onenote-file';
import { RoamJSONImporter } from '../../src/formats/roam-json';
import { TextbundleImporter } from '../../src/formats/textbundle';
import { ImportContext } from '../../src/import-context';
import { PreviewImageStore } from '../../src/preview-image';
import { parseFrontMatterBlock } from '../../src/util';
import { memoryApp, MemoryVault } from '../shims/vault';
import { zipOf } from '../shims/zip';

const imageStores: PreviewImageStore[] = [];
afterEach(() => {
	for (const images of imageStores.splice(0)) images.dispose();
});

provideNodeModules({
	nodeCrypto,
	fs: nodeFs as never,
	os: nodeOs,
	path: nodePath,
	zlib: nodeZlib,
});

type ImporterConstructor = new (...args: ConstructorParameters<typeof FormatImporter>) => FormatImporter;

interface Previewable {
	ready: Promise<void>;
	outputLocation: string;
	files: NodePickedFile[];
	templatePreviewSamples(ctx: ImportContext, images: PreviewImageStore): Promise<NoteTemplateSample[]>;
}

async function previews(
	Importer: ImporterConstructor,
	id: string,
	fixture: string,
	configure?: (subject: FormatImporter) => void,
): Promise<{ samples: NoteTemplateSample[], vault: MemoryVault, subject: FormatImporter }> {
	const vault = new MemoryVault();
	const subject = new Importer(memoryApp(vault), {
		sourceEl: null,
		outputEl: null,
		optionsEl: null,
		plugin: null,
		importerId: id,
		abortController: new AbortController(),
	} as never) as unknown as Previewable & FormatImporter;
	await subject.ready;
	subject.outputLocation = 'Import';
	subject.files = [new NodePickedFile(fixture)];
	configure?.(subject);
	const images = new PreviewImageStore();
	imageStores.push(images);
	return { samples: await subject.templatePreviewSamples(new ImportContext(), images), vault, subject };
}

function fixture(...parts: string[]): string {
	return nodePath.join(__dirname, '..', ...parts);
}

const cases: Array<{
	name: string;
	Importer: ImporterConstructor;
	id: string;
	fixture: string;
}> = [
	{
		name: 'Bear',
		Importer: Bear2bkImporter,
		id: 'bear',
		fixture: fixture('bear', 'backup.bear2bk'),
	},
	{
		name: 'Evernote',
		Importer: EvernoteEnexImporter,
		id: 'evernote',
		fixture: fixture('evernote', 'code-block-language.enex'),
	},
	{
		name: 'Notion export',
		Importer: NotionImporter,
		id: 'notion',
		fixture: fixture('notion', 'notion-testspace.zip'),
	},
	{
		name: 'OneNote file',
		Importer: OneNoteFileImporter,
		id: 'onenote-file',
		fixture: fixture('onenote-file', 'fixtures', 'testOneNote2016.one'),
	},
	{
		name: 'Roam',
		Importer: RoamJSONImporter,
		id: 'roam-json',
		fixture: fixture('roam', 'small-test-graph.json'),
	},
	{
		name: 'Textbundle',
		Importer: TextbundleImporter,
		id: 'textbundle',
		fixture: fixture('textbundle', 'example.textpack'),
	},
];

const localBearApplicationData = fixture('bear', 'local', 'ApplicationData.zip');
if (nodeFs.existsSync(localBearApplicationData)) {
	cases.push({
		name: 'Bear Application Data',
		Importer: Bear2bkImporter,
		id: 'bear',
		fixture: localBearApplicationData,
	});

	test('Bear Application Data keeps preview image URLs mobile-safe', async () => {
		const { samples } = await previews(Bear2bkImporter, 'bear', localBearApplicationData);
		const urls = samples.flatMap(sample =>
			sample.content.match(/blob:[^\s)]+/g) ?? []
		);

		assert.ok(urls.length > 0, 'expected image previews');
		assert.ok(urls.every(url => resolveObjectURL(url)?.type.startsWith('image/')));
	});

	test('Bear shares the preview limit across backup formats', async () => {
		const backup = fixture('bear', 'backup.bear2bk');
		const { samples } = await previews(
			Bear2bkImporter,
			'bear',
			backup,
			importer => {
				(importer as unknown as Previewable).files = [
					new NodePickedFile(backup),
					new NodePickedFile(localBearApplicationData),
				];
			},
		);

		assert.ok(samples.length <= TEMPLATE_PREVIEW_LIMIT);
	});
}

for (const entry of cases) {
	test(`${entry.name} previews real selected notes without writing`, async () => {
		const { samples, vault } = await previews(entry.Importer, entry.id, entry.fixture);
		assert.ok(samples.length > 0, 'expected at least one selected note');
		assert.ok(samples.length <= TEMPLATE_PREVIEW_LIMIT);
		assert.ok(samples.every(sample => sample.title !== 'Imported note'));
		assert.ok(samples.some(sample => sample.content.trim().length > 0));
		assert.deepEqual(vault.paths(), []);
	});
}

test('Bear previews inline images from the selected backup', async () => {
	const { samples, vault } = await previews(
		Bear2bkImporter,
		'bear',
		fixture('bear', 'backup.bear2bk'),
	);
	const withImage = samples.find(sample => sample.content.includes('blob:'));

	assert.ok(withImage, 'expected an image from the Bear backup in the preview');
	assert.doesNotMatch(withImage.content, /\.textbundle\/assets\//);
	assert.deepEqual(vault.paths(), []);
});

test('Bear keeps supported attachment images in mobile previews', async () => {
	const wasMobile = Platform.isMobile;
	try {
		Platform.isMobile = true;
		const { samples } = await previews(
			Bear2bkImporter,
			'bear',
			fixture('bear', 'backup.bear2bk'),
		);
		const withImage = samples.find(sample => sample.content.includes('blob:'));

		assert.ok(withImage, 'expected an image in the mobile preview');
		assert.match(withImage.content, /(?<!\\)!\[/);
	}
	finally {
		Platform.isMobile = wasMobile;
	}
});

test('Bear mobile previews leave dollar signs in code unchanged', () => {
	const wasMobile = Platform.isMobile;
	try {
		Platform.isMobile = true;
		const subject = Object.create(Bear2bkImporter.prototype) as {
			mobileSafePreview(content: string): string;
		};
		const content = 'Price: $5\n`echo $HOME`\n```sh\necho $HOME\n```';

		assert.equal(subject.mobileSafePreview(content),
			'Price: \\$5\n`echo $HOME`\n```sh\necho $HOME\n```');
	}
	finally {
		Platform.isMobile = wasMobile;
	}
});

if (nodeFs.existsSync(localBearApplicationData)) {
	test('Bear shows images but escapes TeX in mobile Application Data previews', async () => {
		const wasMobile = Platform.isMobile;
		try {
			Platform.isMobile = true;
			const { samples } = await previews(Bear2bkImporter, 'bear', localBearApplicationData);

			assert.ok(samples.some(sample => sample.content.includes('\\$')),
				'expected the local fixture to exercise mobile TeX escaping');
			assert.ok(samples.every(sample => !/(?<!\\)\$/.test(sample.content)));
			assert.ok(samples.some(sample => sample.content.includes('blob:')),
				'expected a local attachment image in the mobile preview');
		}
		finally {
			Platform.isMobile = wasMobile;
		}
	});
}

test('Bear tag properties appear in the rendered preview', async () => {
	const { samples, subject } = await previews(
		Bear2bkImporter,
		'bear',
		fixture('bear', 'backup.bear2bk'),
		importer => {
			(importer as unknown as { tagPlacement: string }).tagPlacement = 'property';
		},
	);
	const tagged = samples.find(sample => Array.isArray(sample.generatedProperties?.tags));
	assert.ok(tagged, 'expected a tagged Bear note');

	const rendered = await (subject as unknown as {
		renderTemplatePreview(template: string, sample: NoteTemplateSample): Promise<{ content: string }>;
	}).renderTemplatePreview('{{content}}', tagged);
	const parsed = parseFrontMatterBlock(rendered.content);

	assert.deepEqual(parsed?.frontMatter.tags, tagged.generatedProperties?.tags);
	assert.ok(!(parsed?.body ?? '').includes('#tag'));
});

test('Bear renders an image-heavy preview without exceeding template limits', async () => {
	const { subject, vault } = await previews(Bear2bkImporter, 'bear', fixture('bear', 'backup.bear2bk'));
	const bytes = new Uint8Array(1_900_000);
	bytes.set([137, 80, 78, 71]);
	subject.files = [await zipOf({
		'iceland 2.textbundle/text.md': '# iceland\n\n![](assets/photo.png)\n![](assets/photo.png)',
		'iceland 2.textbundle/assets/photo.png': bytes,
	}, 'Large-image.bear2bk')];
	const images = new PreviewImageStore();
	imageStores.push(images);
	const previewable = subject as unknown as Previewable & {
		renderTemplatePreview(template: string, sample: NoteTemplateSample): Promise<{
			content: string;
			valid: boolean;
			diagnostics: string[];
		}>;
	};
	const [sample] = await previewable.templatePreviewSamples(new ImportContext(), images);
	const preview = await previewable.renderTemplatePreview('{{content}}', sample);
	assert.equal(preview.valid, true);
	assert.deepEqual(preview.diagnostics, []);
	assert.equal(sample.title, 'iceland 2');
	assert.ok(preview.content.length < 1_000);
	const urls = preview.content.match(/blob:[^\s)]+/g) ?? [];
	assert.equal(urls.length, 2);
	assert.equal(urls[0], urls[1]);
	const blob = resolveObjectURL(urls[0]);
	assert.equal(blob?.type, 'image/png');
	assert.deepEqual(new Uint8Array(await blob!.arrayBuffer()), bytes);
	assert.deepEqual(vault.paths(), []);
});

test('Notion export previews reflect the line-break setting', async () => {
	const fixturePath = fixture('notion', 'notion-testspace.zip');
	const { samples: spaced } = await previews(NotionImporter, 'notion', fixturePath);
	const { samples: tight } = await previews(
		NotionImporter,
		'notion',
		fixturePath,
		importer => {
			(importer as NotionImporter).singleLineBreaks = true;
		},
	);

	assert.equal(tight.length, spaced.length);
	assert.ok(tight.some((sample, index) => sample.content.length < spaced[index].content.length));
});

test('Notion export previews omit Notion\'s synthetic Export folder', async () => {
	const { samples } = await previews(
		NotionImporter,
		'notion',
		fixture('notion', 'notion-testspace.zip'),
	);

	assert.ok(samples.some(sample => sample.path === 'Import/Notion-Testspace.md'));
	assert.ok(samples.every(sample => !/(?:^|\/)Export-[0-9a-f-]+(?:\/|$)/iu.test(sample.path)));
});
