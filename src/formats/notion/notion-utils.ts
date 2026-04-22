import type { Moment } from 'moment';
import { parseFilePath } from '../../filesystem';

export const stripNotionId = (id: string) => {
	return id.replace(/-/g, '').replace(/[ -]?[a-z0-9]{32}(\.|$)/, '$1');
};

// Notion UUIDs come at the end of filenames/URL paths and are always 32 characters long.
export const getNotionId = (id: string) => {
	return id.replace(/-/g, '').match(/([a-z0-9]{32})(\?|\.|$)/)?.[1];
};

export const parseParentIds = (filename: string) => {
	const { parent } = parseFilePath(filename);
	return parent
		.split('/')
		.filter((seg) => !/^Export-/i.test(seg)) // Skip Notion export wrapper folder
		.map((parentNote) => getNotionId(parentNote))
		.filter((id) => id) as string[];
};

/**
 * Normalize various Notion date formats to ISO before passing to moment.
 * Handles:
 *  - Korean: "2024년 2월 14일 오후 2:19" → "2024-02-14T14:19"
 *  - Korean date only: "2024년 2월 14일" → "2024-02-14"
 *  - Slash date: "2024/03/18" → "2024-03-18"
 *  - Slash datetime: "2024/03/18 14:19" → "2024-03-18T14:19"
 */
export function normalizeKoreanDate(dateStr: string): string {
	const s = dateStr.trim();

	// Korean locale: 2024년 2월 14일 오후 2:19
	const ko = s.match(
		/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*(오전|오후)\s*(\d{1,2}):(\d{2}))?/
	);
	if (ko) {
		const year = ko[1];
		const month = ko[2].padStart(2, '0');
		const day = ko[3].padStart(2, '0');
		if (!ko[4]) return `${year}-${month}-${day}`;
		let hours = parseInt(ko[5]);
		const minutes = ko[6];
		if (ko[4] === '오후' && hours < 12) hours += 12;
		if (ko[4] === '오전' && hours === 12) hours = 0;
		return `${year}-${month}-${day}T${String(hours).padStart(2, '0')}:${minutes}`;
	}

	// Slash date(time): 2024/03/18 or 2024/03/18 14:19
	const sl = s.match(/^(\d{4})\/(\d{2})\/(\d{2})(?:\s+(\d{2}):(\d{2}))?$/);
	if (sl) {
		const base = `${sl[1]}-${sl[2]}-${sl[3]}`;
		return sl[4] ? `${base}T${sl[4]}:${sl[5]}` : base;
	}

	return s;
}

export function parseDate(content: Moment) {
	if (content.hour() === 0 && content.minute() === 0) {
		return content.format('YYYY-MM-DD');
	}
	else {
		return content.format('YYYY-MM-DDTHH:mm');
	}
}

export function stripParentDirectories(relativeURI: string) {
	return relativeURI.replace(/^(\.\.\/)+/, '');
}

/**
 * Replace all tag-like things #<word> in the document with \#<word>.
 * Useful for programs (like Notion) that don't support #<word> tags.
 *
 * Obsidian #tag may contain
 * - Alphanumeric chars
 * - Any non-ASCI char (U0080 and greater)
 * - Forwardslahes, hyphens, underscores
 *
 * Must contain at least one non-numeric char
 * Full #tag regex is:
 *
 *     /#\d*?(?:[-_/a-z]|[^\x00-\x7F])(?:[-/\w]|[^\x00-\x7F])*()/gi
 *
 * But only need up to first non-numeric char to match valid #tag:
 *
 *     /#\d*?(?:[-_/a-z]|[^\x00-\x7F])/gi
 *
 * @todo Currently cannot ignore #s in multine code/math blocks as this function parses one line at a time.
 */
export function escapeHashtags(body: string) {
	const tagExp = /#\d*?(?:[-_/a-z]|[^\x00-\x7F])/gi;

	if (!tagExp.test(body)) return body;
	const lines = body.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const hashtags = lines[i].match(tagExp);
		if (!hashtags) continue;
		let newLine = lines[i];
		for (let hashtag of hashtags) {
			// skipping any internal links [[ # ]], URLS [ # ]() or []( # ),
			// code ` # ` or already escaped hashtags \#
			const hashtagInLink = new RegExp(
				`\\[\\[[^\\]]*${hashtag}(?:.*[^\\]])?\\]\\]|` +
				`\\[[^\\]]*${hashtag}[^\\]]*\\]\\([^\\)]*\\)` +
				`|\\[[^\\]]*\\]\\([^\\)]*${hashtag}[^\\)]*\\)|` +
				`\\\\${hashtag}|` +
				`\`[^\`]*${hashtag}[^\`]*\``
			);
			if (hashtagInLink.test(newLine)) continue;
			newLine = newLine.replace(hashtag, '\\' + hashtag);
		}
		lines[i] = newLine;
	}
	body = lines.join('\n');
	return body;
}

/**
 * Hoists all child nodes of this node to where this node used to be,
 * removing this node altogether from the DOM.
 */
export function hoistChildren(el: ChildNode) {
	el.replaceWith(...Array.from(el.childNodes));
}
