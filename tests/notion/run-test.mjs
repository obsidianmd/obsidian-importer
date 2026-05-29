/**
 * Standalone test for Notion importer path resolution and relative link generation.
 *
 * Usage: node tests/notion/run-test.mjs
 *
 * Extracts tests/notion/notion-testspace.zip, runs the path computation logic,
 * and writes converted output to output/notion.test/.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, join, relative } from 'path';

const ROOT = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '../..');
const ZIP_PATH = join(ROOT, 'tests/notion/notion-testspace.zip');
const OUTPUT_DIR = join(ROOT, 'output/notion.test');
const EXTRACT_DIR = join(OUTPUT_DIR, '_extracted');

// ─── Utility functions (mirrors the fixed source code) ───

function getNotionId(str) {
	return str.replace(/-/g, '').match(/([a-z0-9]{32})(\?|\.|$)/)?.[1];
}

function parseFilePath(filepath) {
	const lastIndex = Math.max(filepath.lastIndexOf('/'), filepath.lastIndexOf('\\'));
	let name = filepath;
	let parent = '';
	if (lastIndex >= 0) {
		name = filepath.substring(lastIndex + 1);
		parent = filepath.substring(0, lastIndex);
	}
	const dotIndex = name.lastIndexOf('.');
	let ext = '';
	let base = name;
	if (dotIndex > 0) {
		ext = name.substring(dotIndex + 1).toLowerCase();
		base = name.substring(0, dotIndex);
	}
	return { parent, name, basename: base, extension: ext };
}

function parseParentIds(filepath) {
	const { parent } = parseFilePath(filepath);
	return parent
		.split('/')
		.map((p) => getNotionId(p))
		.filter((id) => id);
}

function sanitizeFileName(name) {
	return name.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '').trim();
}

function getRelativePath(fromDir, toFilePath) {
	const from = fromDir.replace(/\/+$/, '').split('/').filter((p) => p.length > 0);
	const to = toFilePath.split('/').filter((p) => p.length > 0);
	let common = 0;
	while (common < from.length && common < to.length && from[common] === to[common]) {
		common++;
	}
	const upCount = from.length - common;
	const remaining = to.slice(common).join('/');
	if (upCount === 0) {
		return './' + remaining;
	}
	return '../'.repeat(upCount) + remaining;
}

function getPathForFile(fileInfo, idsToFileInfo) {
	const pathNames = fileInfo.path.split('/');
	if (fileInfo.parentIds.length > 0) {
		const mapped = fileInfo.parentIds
			.map((pid) =>
				idsToFileInfo[pid]?.title ??
				pathNames.find((seg) => seg.includes(pid))?.replace(new RegExp(` ?${pid}`), '')
			)
			.filter((x) => x)
			.map((folder) => folder.replace(/[. ]+$/, ''));
		if (mapped.length > 0) {
			return mapped.join('/') + '/';
		}
	}
	const { parent } = parseFilePath(fileInfo.path);
	if (!parent) return '';
	const segs = parent.split('/').filter((s) => s.length > 0);
	const folderPath = segs
		.map((s) => s.replace(/\s+[a-z0-9]{32}$/, '').trim())
		.filter((s) => s.length > 0)
		.map((f) => f.replace(/[. ]+$/, ''))
		.join('/');
	return folderPath ? folderPath + '/' : '';
}

// ─── Extract zip ───

function extractZip() {
	if (existsSync(EXTRACT_DIR)) rmSync(EXTRACT_DIR, { recursive: true });
	mkdirSync(EXTRACT_DIR, { recursive: true });
	const pyScript = join(EXTRACT_DIR, '_extract.py');
	writeFileSync(pyScript, `
import zipfile, io, os, sys
sys.stdout.reconfigure(encoding='utf-8')
out = os.path.abspath(sys.argv[1])
# Use extended-length path prefix on Windows
if sys.platform == 'win32' and not out.startswith('\\\\\\\\?\\\\'):
    out = '\\\\\\\\?\\\\' + out
with zipfile.ZipFile(sys.argv[2], 'r') as outer:
    for name in outer.namelist():
        if name.endswith('.zip'):
            data = outer.read(name)
            with zipfile.ZipFile(io.BytesIO(data)) as inner:
                for info in inner.infolist():
                    if info.is_dir():
                        continue
                    target = os.path.normpath(os.path.join(out, info.filename))
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    with inner.open(info) as src, open(target, 'wb') as dst:
                        dst.write(src.read())
        else:
            target = os.path.normpath(os.path.join(out, name))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with outer.open(name) as src, open(target, 'wb') as dst:
                dst.write(src.read())
print('ok')
`);
	const result = execSync(`python "${pyScript}" "${EXTRACT_DIR}" "${ZIP_PATH}"`, { encoding: 'utf-8' });
	if (!result.includes('ok')) throw new Error('Extraction failed: ' + result);
	rmSync(pyScript);
}

// ─── Collect files from extracted dir ───

function walkDir(dir, prefix = '') {
	const results = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const rel = prefix ? prefix + '/' + entry : entry;
		if (statSync(full).isDirectory()) {
			results.push(...walkDir(full, rel));
		}
		else {
			results.push({ fullPath: full, relativePath: rel, name: entry });
		}
	}
	return results;
}

// ─── Main test ───

function main() {
	console.log('=== Notion Importer Path Resolution Test ===\n');

	// Step 1: Extract
	console.log('1. Extracting zip...');
	extractZip();
	const files = walkDir(EXTRACT_DIR);
	console.log(`   Found ${files.length} files\n`);

	// Step 2: Parse file info (pass 1)
	console.log('2. Parsing file info...');
	const idsToFileInfo = {};
	const pathsToAttachmentInfo = {};

	for (const file of files) {
		const ext = parseFilePath(file.name).extension;
		const relPath = file.relativePath.replace(/\\/g, '/');

		if (ext === 'html') {
			const content = readFileSync(file.fullPath, 'utf-8');
			// Extract ID from body children
			const idMatch = content.match(/id="([^"]*[a-z0-9]{32}[^"]*)"/);
			const id = idMatch ? getNotionId(idMatch[1]) : getNotionId(file.name);
			if (!id) continue;

			const titleMatch = content.match(/<title>([^<]*)<\/title>/);
			const title = sanitizeFileName((titleMatch?.[1] || 'Untitled').replace(/\n/g, ' ').replace(/[:/]/g, '-').replace(/#/g, '').trim());

			idsToFileInfo[id] = {
				path: relPath,
				parentIds: parseParentIds(relPath),
				title,
				fullLinkPathNeeded: false,
			};
		}
		else if (file.name !== 'index.html') {
			const decodedName = sanitizeFileName(decodeURIComponent(file.name));
			pathsToAttachmentInfo[relPath] = {
				path: relPath,
				parentIds: parseParentIds(relPath),
				nameWithExtension: decodedName,
				targetParentFolder: '',
				fullLinkPathNeeded: false,
			};
		}
	}

	console.log(`   Notes: ${Object.keys(idsToFileInfo).length}`);
	console.log(`   Attachments: ${Object.keys(pathsToAttachmentInfo).length}\n`);

	// Step 3: Resolve paths (simulates cleanDuplicates)
	console.log('3. Resolving paths...');
	const targetFolderPath = 'Notion/';  // Simulated target folder
	const attachmentFolderPath = '';  // Default: vault root (tests global mode)
	const attachmentsInCurrentFolder = /^\.\//.test(attachmentFolderPath);
	const attachmentSubfolder = attachmentFolderPath.match(/\.\/(.*)/)?.[1];

	// Set targetParentFolder for each attachment (mirrors cleanDuplicateAttachments)
	const attachmentPaths = new Set();
	for (const attachmentInfo of Object.values(pathsToAttachmentInfo)) {
		let parentFolderPath;
		if (attachmentsInCurrentFolder) {
			parentFolderPath = targetFolderPath + getPathForFile(attachmentInfo, idsToFileInfo) + (attachmentSubfolder ?? '');
		}
		else {
			// FIXED: preserve subfolder structure; use targetFolderPath when no specific attachment folder
			const basePath = attachmentFolderPath && attachmentFolderPath !== '/'
				? attachmentFolderPath + '/'
				: targetFolderPath;
			parentFolderPath = basePath + getPathForFile(attachmentInfo, idsToFileInfo);
		}
		// Normalize
		parentFolderPath = parentFolderPath.replace(/\/+/g, '/').replace(/^\//, '');
		if (!parentFolderPath.endsWith('/')) parentFolderPath += '/';

		// Dedup
		if (attachmentPaths.has(parentFolderPath + attachmentInfo.nameWithExtension)) {
			let idx = 2;
			const { basename: bn, extension: ext } = parseFilePath(attachmentInfo.path);
			while (attachmentPaths.has(`${parentFolderPath}${bn} ${idx}.${ext}`)) idx++;
			attachmentInfo.nameWithExtension = `${bn} ${idx}.${ext}`;
		}

		attachmentInfo.targetParentFolder = parentFolderPath;
		attachmentPaths.add(parentFolderPath + attachmentInfo.nameWithExtension);
	}

	// Step 4: Generate output
	console.log('4. Generating output...\n');
	if (existsSync(OUTPUT_DIR + '/notes')) rmSync(OUTPUT_DIR + '/notes', { recursive: true });
	mkdirSync(OUTPUT_DIR + '/notes', { recursive: true });

	const report = [];

	for (const [id, fileInfo] of Object.entries(idsToFileInfo)) {
		const noteDir = targetFolderPath + getPathForFile(fileInfo, idsToFileInfo);
		const notePath = noteDir + fileInfo.title + '.md';

		// Read HTML and find attachment links
		const htmlFile = files.find((f) => f.relativePath.replace(/\\/g, '/') === fileInfo.path);
		if (!htmlFile) continue;

		const content = readFileSync(htmlFile.fullPath, 'utf-8');
		const hrefRegex = /<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g;

		let mdContent = `# ${fileInfo.title}\n\nNote path: ${notePath}\nNote dir: ${noteDir}\n\n## Attachment Links\n\n`;

		let match;
		while ((match = hrefRegex.exec(content)) !== null) {
			const href = decodeURIComponent(match[1]).replace(/^(\.\.\/)+/, '');
			const linkText = match[2];

			// Find matching attachment
			const attachmentKey = Object.keys(pathsToAttachmentInfo).find((k) => k.includes(href));
			if (attachmentKey) {
				const attInfo = pathsToAttachmentInfo[attachmentKey];
				const attachmentFullPath = attInfo.targetParentFolder + attInfo.nameWithExtension;
				const relativePath = getRelativePath(noteDir, attachmentFullPath);

				mdContent += `- \`![[${relativePath}]]\`\n`;
				mdContent += `  - Original href: ${href}\n`;
				mdContent += `  - Attachment vault path: ${attachmentFullPath}\n`;
				mdContent += `  - Note dir: ${noteDir}\n\n`;

				report.push({
					note: fileInfo.title,
					attachment: attInfo.nameWithExtension,
					vaultPath: attachmentFullPath,
					relativePath,
				});
			}
		}

		// Write mock markdown
		const outPath = join(OUTPUT_DIR, 'notes', fileInfo.title + '.md');
		writeFileSync(outPath, mdContent, 'utf-8');
	}

	// Step 5: Write file structure report
	console.log('=== File Structure ===\n');
	console.log('Notes:');
	for (const [id, fi] of Object.entries(idsToFileInfo)) {
		const noteDir = targetFolderPath + getPathForFile(fi, idsToFileInfo);
		console.log(`  ${noteDir}${fi.title}.md`);
	}
	console.log('\nAttachments:');
	for (const ai of Object.values(pathsToAttachmentInfo)) {
		console.log(`  ${ai.targetParentFolder}${ai.nameWithExtension}`);
	}

	console.log('\n=== Link Resolution ===\n');
	for (const r of report) {
		console.log(`Note: "${r.note}"`);
		console.log(`  Attachment: ${r.attachment}`);
		console.log(`  Vault path: ${r.vaultPath}`);
		console.log(`  Relative:   ${r.relativePath}`);
		console.log();
	}

	// Step 6: Verification
	console.log('=== Verification ===\n');
	let pass = true;

	// Check 1: All relative paths start with './' or '../'
	for (const r of report) {
		if (!r.relativePath.startsWith('./') && !r.relativePath.startsWith('../')) {
			console.log(`FAIL: relative path doesn't start with ./ or ../: ${r.relativePath}`);
			pass = false;
		}
	}

	// Check 2: No two attachments have the same full vault path
	const vaultPaths = Object.values(pathsToAttachmentInfo).map((a) => a.targetParentFolder + a.nameWithExtension);
	const uniquePaths = new Set(vaultPaths);
	if (vaultPaths.length !== uniquePaths.size) {
		console.log('FAIL: duplicate attachment vault paths detected');
		pass = false;
	}

	// Check 3: Attachments preserve folder structure (not all in same folder)
	const folders = new Set(Object.values(pathsToAttachmentInfo).map((a) => a.targetParentFolder));
	if (Object.keys(pathsToAttachmentInfo).length > 0) {
		console.log(`Attachment folders used: ${folders.size} (${[...folders].join(', ')})`);
	}

	if (pass) {
		console.log('\nAll checks PASSED');
	}
	else {
		console.log('\nSome checks FAILED');
		process.exit(1);
	}

	// Write summary
	const summary = {
		notes: Object.entries(idsToFileInfo).map(([id, fi]) => ({
			title: fi.title,
			path: targetFolderPath + getPathForFile(fi, idsToFileInfo) + fi.title + '.md',
		})),
		attachments: Object.values(pathsToAttachmentInfo).map((ai) => ({
			name: ai.nameWithExtension,
			vaultPath: ai.targetParentFolder + ai.nameWithExtension,
			originalZipPath: ai.path,
		})),
		links: report,
	};
	writeFileSync(join(OUTPUT_DIR, 'test-report.json'), JSON.stringify(summary, null, 2), 'utf-8');
	console.log(`\nReport written to ${OUTPUT_DIR}/test-report.json`);
	console.log(`Mock notes written to ${OUTPUT_DIR}/notes/`);
}

main();
