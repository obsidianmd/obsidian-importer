import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { convertLocal, LocalResult } from '../../src/formats/logseq/pipeline';
import { resolveBlockRefs, removeOrphanBlockRefs, BlockRefTarget } from '../../src/formats/logseq/block-ids';
import { convertTags, rewriteAliasReferences, LinkIndex } from '../../src/formats/logseq/links';
import { DEFAULT_LOGSEQ_OPTIONS, LogseqImportOptions } from '../../src/formats/logseq/options';
import { namespaceToPath, decodeLogseqName } from '../../src/formats/logseq/paths';
import { journalFilenameToISO } from '../../src/formats/logseq/journals';

const FIXTURE_ROOT = join(import.meta.dirname, 'fixtures');

interface ConvertedFile {
	outputPath: string;
	local: LocalResult;
	finalBody: string;
	sourceFile: string;
}

function loadFixtureGraph(opts: LogseqImportOptions = DEFAULT_LOGSEQ_OPTIONS): ConvertedFile[] {
	const pagesDir = join(FIXTURE_ROOT, 'pages');
	const journalsDir = join(FIXTURE_ROOT, 'journals');

	const files: { path: string, content: string, kind: 'page' | 'journal', stem: string }[] = [];

	for (const f of readdirSync(pagesDir)) {
		if (!f.endsWith('.md')) continue;
		const stem = f.slice(0, -3);
		files.push({ path: join(pagesDir, f), content: readFileSync(join(pagesDir, f), 'utf8'), kind: 'page', stem });
	}
	for (const f of readdirSync(journalsDir)) {
		if (!f.endsWith('.md')) continue;
		const stem = f.slice(0, -3);
		files.push({ path: join(journalsDir, f), content: readFileSync(join(journalsDir, f), 'utf8'), kind: 'journal', stem });
	}

	const locals: { file: typeof files[0], local: LocalResult, outputPath: string }[] = [];
	const blockIndex = new Map<string, BlockRefTarget>();
	const aliasMap = new Map<string, string>();

	for (const file of files) {
		const local = convertLocal(file.content, opts);

		let outputPath: string;
		if (file.kind === 'journal') {
			const iso = journalFilenameToISO(file.stem);
			outputPath = iso ?? file.stem;
		}
		else {
			outputPath = namespaceToPath(decodeLogseqName(file.stem));
		}

		for (const id of local.ids) {
			blockIndex.set(id.uuid, { page: outputPath, shortId: id.shortId });
		}

		const canonical = outputPath;
		const aliasValue = local.raw.alias || local.raw.aliases || '';
		if (aliasValue) {
			for (const raw of aliasValue.split(',')) {
				const cleaned = raw.trim().replace(/^\[\[|\]\]$/g, '');
				if (cleaned) aliasMap.set(cleaned.toLowerCase(), canonical);
			}
		}

		locals.push({ file, local, outputPath });
	}

	const knownPages = new Set<string>();
	for (const { outputPath } of locals) {
		knownPages.add(outputPath.toLowerCase());
		const parts = outputPath.split('/');
		knownPages.add(parts[parts.length - 1].toLowerCase());
	}

	const linkIndex: LinkIndex = { aliasMap };
	const results: ConvertedFile[] = [];

	for (const { file, local, outputPath } of locals) {
		let body = resolveBlockRefs(local.body, blockIndex);
		if (opts.removeOrphanBlockRefs) body = removeOrphanBlockRefs(body);
		body = rewriteAliasReferences(body, linkIndex);
		body = convertTags(body, {
			toLinks: opts.convertTagsToLinks,
			onlyExistingPages: opts.convertTagsOnlyExistingPages,
			knownPages,
			dropTags: new Set(opts.dropTags),
		});
		results.push({ outputPath, local, finalBody: body, sourceFile: file.path });
	}

	return results;
}

function findByOutput(results: ConvertedFile[], outputPath: string): ConvertedFile {
	const found = results.find(r => r.outputPath === outputPath);
	if (!found) throw new Error(`No result for output path: ${outputPath}`);
	return found;
}

const graph = loadFixtureGraph();

test('E2E: namespace page gets folder-based output path', () => {
	const dp = findByOutput(graph, 'algorithms/dynamic programming');
	assert.ok(dp);
});

test('E2E: deeply nested namespace page resolves', () => {
	const memo = findByOutput(graph, 'algorithms/dynamic programming/memoization');
	assert.ok(memo);
});

test('E2E: percent-encoded page name is decoded', () => {
	const john = findByOutput(graph, 'Encoded:Colon');
	assert.ok(john);
});

test('E2E: journal file gets ISO date path', () => {
	const j1 = findByOutput(graph, '2024-06-15');
	const j2 = findByOutput(graph, '2024-08-30');
	assert.ok(j1);
	assert.ok(j2);
});


test('E2E: page properties produce correct YAML frontmatter', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.local.yaml.includes('aliases:'));
	assert.ok(pn.local.yaml.includes('  - MP'));
	assert.ok(pn.local.yaml.includes('  - main-page'));
	assert.ok(pn.local.yaml.includes('tags:'));
	assert.ok(pn.local.yaml.includes('  - topic'));
	assert.ok(pn.local.yaml.includes('  - area'));
});

test('E2E: title is dropped from YAML but kept in raw', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(!pn.local.yaml.includes('title:'));
	assert.equal(pn.local.raw.title, 'Main Page');
});

test('E2E: page without properties gets no frontmatter', () => {
	const memo = findByOutput(graph, 'algorithms/dynamic programming/memoization');
	assert.equal(memo.local.yaml, '');
});


test('E2E: TODO with priority A and SCHEDULED (emoji)', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('- [ ] Write documentation ⏫ ⏳ 2024-06-15 ➕ 2024-06-01'));
});

test('E2E: DOING with priority B and DEADLINE with repeater', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('- [/] Review sample changes 🔼 📅 2024-06-20 🔁 every week when done'));
});

test('E2E: DONE with completion date and LOGBOOK dropped', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('- [x] Ship v1.0 ✅ 2024-06-10'));
	assert.ok(!pn.finalBody.includes(':LOGBOOK:'));
	assert.ok(!pn.finalBody.includes('CLOCK:'));
});

test('E2E: CANCELLED with cancelled date', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('- [-] Old task ❌ 2024-05-30'));
});

test('E2E: WAITING maps to open checkbox', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('- [ ] Waiting on upstream'));
});

test('E2E: WAIT maps to open checkbox', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('- [ ] For feedback'));
});

test('E2E: IN-PROGRESS maps to open checkbox', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('- [ ] Halfway done'));
});

test('E2E: LATER with both SCHEDULED and DEADLINE', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('- [ ] Low priority task ⏳ 2024-09-01 🔁 every 2 weeks when done 📅 2024-09-15'));
});

test('E2E: NOW maps to in-progress checkbox', () => {
	const j2 = findByOutput(graph, '2024-08-30');
	assert.ok(j2.finalBody.includes('- [/] Working on something'));
});

test('E2E: priority C in journal', () => {
	const j2 = findByOutput(graph, '2024-08-30');
	assert.ok(j2.finalBody.includes('- [ ] Journal task with priority 🔽'));
});


test('E2E: block ref resolves to correct page and short id', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('[[Reference Page#^a1b2c3]]'));
});

test('E2E: embed block ref resolves with ! prefix', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('![[Reference Page#^a1b2c3]]'));
});

test('E2E: page embed resolves', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('![[Reference Page]]'));
});

test('E2E: block ref from journal to page resolves', () => {
	const j1 = findByOutput(graph, '2024-06-15');
	assert.ok(j1.finalBody.includes('[[Main Page#^'));
});

test('E2E: cross-namespace block ref resolves', () => {
	const memo = findByOutput(graph, 'algorithms/dynamic programming/memoization');
	assert.ok(memo.finalBody.includes('[[algorithms/dynamic programming#^'));
});


test('E2E: block id is shortened and appended as anchor', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('^aaaaaa'));
	assert.ok(!pn.finalBody.includes('id:: aaaaaaaa'));
});

test('E2E: block id in Reference Page is shortened', () => {
	const mn = findByOutput(graph, 'Reference Page');
	assert.ok(mn.local.ids.length === 1);
	assert.equal(mn.local.ids[0].uuid, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
	assert.ok(mn.local.ids[0].shortId.length <= 8);
});


test('E2E: alias reference [[MP]] rewrites to [[Main Page|MP]]', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('[[Main Page|MP]]'));
});

test('E2E: alias reference in journal rewrites correctly', () => {
	const j1 = findByOutput(graph, '2024-06-15');
	assert.ok(j1.finalBody.includes('[[Main Page|MP]]'));
});

test('E2E: alias reference in Reference Page rewrites correctly', () => {
	const mn = findByOutput(graph, 'Reference Page');
	assert.ok(mn.finalBody.includes('[[Main Page|MP]]'));
});


test('E2E: alias link syntax converts to wikilink with display text', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('[[Reference Page|My Alias]]'));
});


test('E2E: natural date link [[Jan 15th, 2024]] becomes ISO', () => {
	const mn = findByOutput(graph, 'Reference Page');
	assert.ok(mn.finalBody.includes('[[2024-01-15]]'));
});

test('E2E: natural date link [[Feb 2nd, 2024]] becomes ISO', () => {
	const mn = findByOutput(graph, 'Reference Page');
	assert.ok(mn.finalBody.includes('[[2024-02-02]]'));
});

test('E2E: date link in journal [[Aug 30th, 2024]] becomes ISO', () => {
	const j1 = findByOutput(graph, '2024-06-15');
	assert.ok(j1.finalBody.includes('[[2024-08-30]]'));
});

test('E2E: date link [[Dec 2nd, 2023]] in second journal', () => {
	const j2 = findByOutput(graph, '2024-08-30');
	assert.ok(j2.finalBody.includes('[[2023-12-02]]'));
});


test('E2E: simple hashtag preserved (default: keep as tag)', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('#topic'));
});

test('E2E: multi-word tag sanitized to hyphens', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('#multi-word-tag'));
});


test('E2E: highlights converted to == marks', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('==Important=='));
	assert.ok(!pn.finalBody.includes('^^Important^^'));
});

test('E2E: highlight inside inline code is not converted', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('`^^code^^`'));
});


test('E2E: {{video URL}} becomes ![](URL)', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('![](https://example.com/video.mp4)'));
	assert.ok(!pn.finalBody.includes('{{video'));
});

test('E2E: {{youtube URL}} becomes ![](URL)', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)'));
	assert.ok(!pn.finalBody.includes('{{youtube'));
});

test('E2E: {{tweet URL}} becomes ![](URL)', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('![](https://twitter.com/user/status/123)'));
	assert.ok(!pn.finalBody.includes('{{tweet'));
});


test('E2E: logseq numbered list markers become 1. 2.', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('1. First'));
	assert.ok(pn.finalBody.includes('2. Second'));
	assert.ok(!pn.finalBody.includes('logseq.order-list-type'));
});


test('E2E: asset with dimensions becomes ![[file|WxH]]', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('![[diagram.png|600x400]]'));
});

test('E2E: asset without dimensions becomes ![[file]]', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('![[report.pdf]]'));
});

test('E2E: asset references are collected', () => {
	const pn = findByOutput(graph, 'Main Page');
	const filenames = pn.local.assets.map(a => a.filename);
	assert.ok(filenames.includes('diagram.png'));
	assert.ok(filenames.includes('report.pdf'));
});

test('E2E: journal references to assets are also converted', () => {
	const j1 = findByOutput(graph, '2024-06-15');
	assert.ok(j1.finalBody.includes('![[diagram.png]]'));
	assert.ok(j1.local.assets.some(a => a.filename === 'diagram.png'));
});


test('E2E: QUOTE block becomes blockquote', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('> A wise quote'));
});

test('E2E: WARNING block with title becomes callout', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('> [!warning] Watch out!'));
	assert.ok(pn.finalBody.includes('> This could break things.'));
});

test('E2E: COMMENT block becomes Obsidian comment', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('%%'));
	assert.ok(pn.finalBody.includes('internal note'));
});

test('E2E: IMPORTANT block becomes callout', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('> [!important]'));
	assert.ok(pn.finalBody.includes('Don\'t forget this'));
});

test('E2E: CAUTION block becomes callout', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('> [!caution]'));
	assert.ok(pn.finalBody.includes('Be careful'));
});

test('E2E: EXAMPLE block becomes callout', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('> [!example]'));
	assert.ok(pn.finalBody.includes('some example text'));
});


test('E2E: code blocks in lists get proper fence alignment', () => {
	const pn = findByOutput(graph, 'Main Page');
	const lines = pn.finalBody.split('\n');
	const openIdx = lines.findIndex(l => l.includes('```python'));
	assert.ok(openIdx >= 0);
	const openIndent = lines[openIdx].indexOf('```');
	let closeIdx = -1;
	for (let i = openIdx + 1; i < lines.length; i++) {
		if (/^\s*```\s*$/.test(lines[i])) {
			closeIdx = i;
			break;
		}
	}
	assert.ok(closeIdx > openIdx);
	const closeIndent = lines[closeIdx].indexOf('```');
	assert.equal(openIndent, closeIndent);
});


test('E2E: heading:: 2 property produces ## prefix on the block', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(pn.finalBody.includes('- ## Section header'));
	assert.ok(!pn.finalBody.includes('heading:: 2'));
});


test('E2E: collapsed:: and logseq.* properties are removed', () => {
	const pn = findByOutput(graph, 'Main Page');
	assert.ok(!pn.finalBody.includes('collapsed::'));
	assert.ok(!pn.finalBody.includes('logseq.order-list-type'));
});


test('E2E: dataview format produces inline fields', () => {
	const dvOpts: LogseqImportOptions = { ...DEFAULT_LOGSEQ_OPTIONS, taskFormat: 'tasks-dataview' };
	const dvGraph = loadFixtureGraph(dvOpts);
	const pn = findByOutput(dvGraph, 'Main Page');
	assert.ok(pn.finalBody.includes('[priority:: high]'));
	assert.ok(pn.finalBody.includes('[scheduled:: 2024-06-15]'));
	assert.ok(pn.finalBody.includes('[created:: 2024-06-01]'));
	assert.ok(pn.finalBody.includes('[completion:: 2024-06-10]'));
	assert.ok(pn.finalBody.includes('[cancelled:: 2024-05-30]'));
});

test('E2E: dataview format produces due for deadlines', () => {
	const dvOpts: LogseqImportOptions = { ...DEFAULT_LOGSEQ_OPTIONS, taskFormat: 'tasks-dataview' };
	const dvGraph = loadFixtureGraph(dvOpts);
	const pn = findByOutput(dvGraph, 'Main Page');
	assert.ok(pn.finalBody.includes('[due:: 2024-06-20]'));
});


test('E2E: plain format collapses states to basic checkboxes', () => {
	const plainOpts: LogseqImportOptions = { ...DEFAULT_LOGSEQ_OPTIONS, taskFormat: 'plain' };
	const plainGraph = loadFixtureGraph(plainOpts);
	const pn = findByOutput(plainGraph, 'Main Page');
	assert.ok(pn.finalBody.includes('- [ ] [#A] Write documentation'));
	assert.ok(pn.finalBody.includes('- [x] Ship v1.0'));
	assert.ok(pn.finalBody.includes('- [x] Old task'));
});


test('E2E: full UUID mode keeps complete block ids', () => {
	const fullOpts: LogseqImportOptions = { ...DEFAULT_LOGSEQ_OPTIONS, shortenBlockIds: false };
	const fullGraph = loadFixtureGraph(fullOpts);
	const pn = findByOutput(fullGraph, 'Main Page');
	assert.ok(pn.finalBody.includes('^aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'));
});


test('E2E: LOGBOOK kept when option is set', () => {
	const keepOpts: LogseqImportOptions = { ...DEFAULT_LOGSEQ_OPTIONS, logbook: 'keep' };
	const keepGraph = loadFixtureGraph(keepOpts);
	const pn = findByOutput(keepGraph, 'Main Page');
	assert.ok(pn.finalBody.includes(':LOGBOOK:'));
	assert.ok(pn.finalBody.includes('CLOCK:'));
});


test('E2E: tags converted to wikilinks when option enabled', () => {
	const linkOpts: LogseqImportOptions = { ...DEFAULT_LOGSEQ_OPTIONS, convertTagsToLinks: true, convertTagsOnlyExistingPages: false };
	const linkGraph = loadFixtureGraph(linkOpts);
	const pn = findByOutput(linkGraph, 'Main Page');
	assert.ok(pn.finalBody.includes('[[topic]]'));
	assert.ok(pn.finalBody.includes('[[multi word tag]]'));
	assert.ok(!pn.finalBody.includes('#topic'));
});


test('E2E: alt text preserved when option enabled (no dimensions)', () => {
	const altOpts: LogseqImportOptions = { ...DEFAULT_LOGSEQ_OPTIONS, keepAssetAltText: true };
	const altGraph = loadFixtureGraph(altOpts);
	const j1 = findByOutput(altGraph, '2024-06-15');
	assert.ok(j1.finalBody.includes('![[diagram.png|photo]]'));
});

test('E2E: dimensions still win over alt text', () => {
	const altOpts: LogseqImportOptions = { ...DEFAULT_LOGSEQ_OPTIONS, keepAssetAltText: true };
	const altGraph = loadFixtureGraph(altOpts);
	const pn = findByOutput(altGraph, 'Main Page');
	assert.ok(pn.finalBody.includes('![[diagram.png|600x400]]'));
});


test('E2E: no content is silently deleted (all fixture files produce output)', () => {
	assert.ok(graph.length >= 7); // 5 pages + 2 journals
	for (const r of graph) {
		assert.ok(r.finalBody.length > 0, `Empty body for ${r.outputPath}`);
	}
});

test('E2E: no raw ((uuid)) references remain unresolved when defined in graph', () => {
	const definedUuids = new Set<string>();
	for (const r of graph) {
		for (const id of r.local.ids) definedUuids.add(id.uuid);
	}
	for (const r of graph) {
		const unresolvedRefs = r.finalBody.match(/\(\([^()]+\)\)/g) ?? [];
		for (const ref of unresolvedRefs) {
			const uuid = ref.slice(2, -2);
			assert.ok(!definedUuids.has(uuid), `Unresolved ref ((${uuid})) in ${r.outputPath} but it IS defined`);
		}
	}
});

test('E2E: no id:: property lines remain in output', () => {
	for (const r of graph) {
		assert.ok(!r.finalBody.includes('id::'), `Leftover id:: in ${r.outputPath}`);
	}
});
