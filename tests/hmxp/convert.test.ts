import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';

import {
	convertHmxpTopicXml,
	parseHmxpTocXml,
	renderHmxpKeywordsMarkdown,
	renderHmxpTocMarkdown,
} from '../../src/formats/hmxp/convert';

globalThis.DOMParser = DOMParser as unknown as typeof globalThis.DOMParser;

test('converts Help+Manual topic XML into Markdown', () => {
	const topic = convertHmxpTopicXml(`<?xml version="1.0" encoding="UTF-8"?>
		<topic>
			<title>Install Guide</title>
			<keywords>
				<keyword>setup</keyword>
				<keyword>install</keyword>
			</keywords>
			<body>
				<header>
					<para styleclass="Heading1">Install Guide</para>
				</header>
				<para styleclass="Normal">Use <text style="font-weight:bold;">bold</text>, <text style="font-style:italic;">italic</text>, and <text style="font-family:'Courier New';">code</text>.</para>
				<para styleclass="Heading2">Steps</para>
				<list type="ol">
					<li><para>Open <link type="topiclink" href="h123456">the overview</link>.</para></li>
					<li><para>Visit <link type="weblink" href="https://example.com">docs</link>.</para></li>
				</list>
				<para>
					<table>
						<tr><td><para>Name</para></td><td><para>Value</para></td></tr>
						<tr><td><para>A</para></td><td><para>B|C</para></td></tr>
					</table>
				</para>
				<para><conditional-text type="IF" value="HTML"/>Keep &lt;%NAME%&gt; visible.</para>
				<para><image src="../Images/screenshot.png"/></para>
			</body>
		</topic>`, 'h100000', {
		topicIds: new Set(['h123456']),
		resolveAttachment: source => `Help+Manual import/Attachments/${source.split('/').pop()}`,
	});

	assert.equal(topic.title, 'Install Guide');
	assert.deepEqual(topic.keywords, ['setup', 'install']);
	assert.deepEqual(topic.attachments, [{
		source: '../Images/screenshot.png',
		markdownPath: 'Help+Manual import/Attachments/screenshot.png',
	}]);
	assert.equal(topic.markdown, `# Install Guide

Use **bold**, *italic*, and \`code\`.

### Steps

1. Open [[h123456|the overview]].
2. Visit [docs](https://example.com).

| Name | Value |
| --- | --- |
| A | B\\|C |

<IF HTML>Keep <%NAME%> visible.

![[Help+Manual import/Attachments/screenshot.png]]
`);
});

test('renders Help+Manual table of contents and keyword index', () => {
	const toc = parseHmxpTocXml(`<?xml version="1.0" encoding="UTF-8"?>
		<map defaulttopic="h100000">
			<topicref href="h100000"><caption>Install Guide</caption>
				<topicref href="h123456"><caption>Overview</caption></topicref>
			</topicref>
		</map>`);

	assert.deepEqual(toc, [{
		id: 'h100000',
		caption: 'Install Guide',
		children: [{
			id: 'h123456',
			caption: 'Overview',
			children: [],
		}],
	}]);
	assert.equal(renderHmxpTocMarkdown(toc), `# Table of Contents

- [[h100000|Install Guide]]
  - [[h123456|Overview]]
`);

	const first = convertHmxpTopicXml('<topic><title>Install Guide</title><keywords><keyword>setup</keyword></keywords><body/></topic>', 'h100000');
	const second = convertHmxpTopicXml('<topic><title>Overview</title><keywords><keyword>setup</keyword></keywords><body/></topic>', 'h123456');

	assert.equal(renderHmxpKeywordsMarkdown([second, first]), `# Keywords

## setup

- [[h100000|Install Guide]]
- [[h123456|Overview]]
`);
});
