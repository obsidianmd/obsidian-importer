import { parseHTML } from '../../util';

export interface XMindTopic {
	id: string;
	title: string;
	notes: string;
	labels: string[];
	markers: string[];
	href: string;
	image: string;
	children: XMindTopic[];
	callouts: XMindTopic[];
}

export interface XMindSheet {
	id: string;
	title: string;
	rootTopic: XMindTopic;
}

export interface XMindData {
	sheets: XMindSheet[];
}

export interface XMindAttachment {
	zipPath: string;
	filename: string;
}

export interface XMindNote {
	title: string;
	path: string[];
	content: string;
	attachments: XMindAttachment[];
}

export function parseXMindJson(json: string): XMindData {
	const sheets = JSON.parse(json) as unknown[];
	return { sheets: sheets.map(parseJsonSheet) };
}

function str(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function parseJsonSheet(raw: unknown): XMindSheet {
	const sheet = raw as Record<string, unknown>;
	return {
		id: str(sheet['id']),
		title: str(sheet['title']),
		rootTopic: parseJsonTopic(sheet['rootTopic'] as Record<string, unknown> ?? {}),
	};
}

function parseJsonTopic(raw: Record<string, unknown>): XMindTopic {
	const children = raw['children'] as Record<string, unknown> | undefined;
	const attached = (children?.['attached'] as unknown[]) ?? [];
	const detached = (children?.['detached'] as unknown[]) ?? [];
	const calloutRaw = (children?.['callout'] as unknown[]) ?? [];
	const notes = raw['notes'] as Record<string, Record<string, string>> | undefined;
	const labels = (raw['labels'] as string[]) ?? [];
	const markersRaw = (raw['markers'] as { markerId: string }[]) ?? [];
	const imageRaw = raw['image'] as { src?: string } | undefined;

	return {
		id: str(raw['id']),
		title: str(raw['title']),
		notes: notes?.['plain']?.['content'] ?? '',
		labels,
		markers: markersRaw.map(m => m.markerId),
		href: str(raw['href']),
		image: imageRaw?.src ?? '',
		children: [...attached, ...detached].map(child => parseJsonTopic(child as Record<string, unknown>)),
		callouts: calloutRaw.map(c => parseJsonTopic(c as Record<string, unknown>)),
	};
}

export function parseXMindXml(xml: string): XMindData {
	const doc = parseHTML(xml);
	const sheetEls = doc.querySelectorAll('sheet');
	const sheets: XMindSheet[] = [];

	for (const sheetEl of Array.from(sheetEls)) {
		const title = directChildText(sheetEl, 'title');
		const topicEl = sheetEl.querySelector(':scope > topic');
		if (!topicEl) continue;

		sheets.push({
			id: sheetEl.getAttribute('id') ?? '',
			title,
			rootTopic: parseXmlTopic(topicEl),
		});
	}

	return { sheets };
}

function directChildText(el: Element, tagName: string): string {
	for (const child of Array.from(el.children)) {
		if (child.tagName.toLowerCase() === tagName) {
			return child.textContent?.trim() ?? '';
		}
	}
	return '';
}

function parseXmlTopic(el: Element): XMindTopic {
	const title = directChildText(el, 'title');
	const notesEl = el.querySelector(':scope > notes');
	const plainNotes = notesEl ? directChildText(notesEl, 'plain') : '';

	const labelsEl = el.querySelector(':scope > labels');
	const labels: string[] = [];
	if (labelsEl) {
		for (const labelEl of Array.from(labelsEl.querySelectorAll('label'))) {
			const text = labelEl.textContent?.trim();
			if (text) labels.push(text);
		}
	}

	const markerRefsEl = el.querySelector(':scope > marker-refs');
	const markers: string[] = [];
	if (markerRefsEl) {
		for (const ref of Array.from(markerRefsEl.querySelectorAll('marker-ref'))) {
			const markerId = ref.getAttribute('marker-id');
			if (markerId) markers.push(markerId);
		}
	}

	const href = el.getAttribute('xlink:href') ?? el.getAttribute('href') ?? '';

	const children: XMindTopic[] = [];
	const childrenEl = el.querySelector(':scope > children');
	if (childrenEl) {
		for (const topicsEl of Array.from(childrenEl.querySelectorAll(':scope > topics'))) {
			for (const topicEl of Array.from(topicsEl.querySelectorAll(':scope > topic'))) {
				children.push(parseXmlTopic(topicEl));
			}
		}
	}

	return { id: el.getAttribute('id') ?? '', title, notes: plainNotes, labels, markers, href, image: '', children, callouts: [] };
}

const MAX_HEADING_DEPTH = 4;

export function convertSheet(sheet: XMindSheet, splitDepth: number): XMindNote[] {
	const rootTitle = sheet.rootTopic.title || sheet.title;

	if (splitDepth <= 0) {
		const lines: string[] = [];
		const attachments: XMindAttachment[] = [];
		renderTopic(lines, attachments, sheet.rootTopic, 1);
		return [{ title: rootTitle, path: [], content: lines.join('\n') + '\n', attachments }];
	}

	const notes: XMindNote[] = [];
	renderNetworkTopic(notes, sheet.rootTopic, 0, splitDepth, []);
	if (notes.length > 0 && !notes[0].title) {
		notes[0].title = rootTitle;
	}
	return notes;
}

export function convertSheetToMarkdown(sheet: XMindSheet): string {
	return convertSheet(sheet, 0)[0].content;
}

function renderNetworkTopic(
	notes: XMindNote[], topic: XMindTopic, depth: number, splitDepth: number, parentPath: string[]
): void {
	const lines: string[] = [];
	const attachments: XMindAttachment[] = [];
	const title = topic.href ? `[${topic.title}](${topic.href})` : topic.title;

	lines.push(`# ${title}${labelSuffix(topic)}${markerSuffix(topic)}`);
	appendTopicMeta(lines, attachments, topic, '');

	const childNotes: XMindNote[] = [];
	const childPath = [...parentPath, topic.title];

	for (const child of topic.children) {
		if (depth + 1 <= splitDepth) {
			lines.push(`- [[${child.title}]]`);
			renderNetworkTopic(childNotes, child, depth + 1, splitDepth, childPath);
		}
		else {
			renderTopic(lines, attachments, child, 2);
		}
	}

	notes.push({ title: topic.title, path: parentPath, content: lines.join('\n') + '\n', attachments });
	notes.push(...childNotes);
}

function renderTopic(lines: string[], attachments: XMindAttachment[], topic: XMindTopic, depth: number): void {
	const title = topic.href ? `[${topic.title}](${topic.href})` : topic.title;

	if (depth <= MAX_HEADING_DEPTH) {
		lines.push(`${'#'.repeat(depth)} ${title}${labelSuffix(topic)}${markerSuffix(topic)}`);
		appendTopicMeta(lines, attachments, topic, '');
		for (const child of topic.children) {
			renderTopic(lines, attachments, child, depth + 1);
		}
	}
	else {
		const bulletDepth = depth - MAX_HEADING_DEPTH - 1;
		const indent = '\t'.repeat(bulletDepth);
		lines.push(`${indent}- ${title}${labelSuffix(topic)}${markerSuffix(topic)}`);
		appendTopicMeta(lines, attachments, topic, indent);
		for (const child of topic.children) {
			renderTopic(lines, attachments, child, depth + 1);
		}
	}
}

function labelSuffix(topic: XMindTopic): string {
	if (topic.labels.length === 0) return '';
	return ` \`${topic.labels.join('` `')}\``;
}

function markerSuffix(topic: XMindTopic): string {
	if (topic.markers.length === 0) return '';
	return ' ' + topic.markers.map(m => `#${m}`).join(' ');
}

function appendTopicMeta(lines: string[], attachments: XMindAttachment[], topic: XMindTopic, indent: string): void {
	if (topic.notes) {
		for (const noteLine of topic.notes.split('\n')) {
			lines.push(`${indent}> ${noteLine}`);
		}
	}
	for (const callout of topic.callouts) {
		lines.push(`${indent}> *${callout.title}*`);
	}
	if (topic.image) {
		const zipPath = topic.image.replace(/^xap:/, '');
		const filename = zipPath.split('/').pop() ?? zipPath;
		lines.push(`${indent}![[${filename}]]`);
		attachments.push({ zipPath, filename });
	}
}
