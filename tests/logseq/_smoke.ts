import { readFileSync } from 'node:fs';
import { convertLocal } from '../../src/formats/logseq/pipeline';
import { resolveBlockRefs } from '../../src/formats/logseq/block-ids';
import { rewriteAliasReferences } from '../../src/formats/logseq/links';
import { DEFAULT_LOGSEQ_OPTIONS } from '../../src/formats/logseq/options';

const file = process.argv[2];
const content = readFileSync(file, 'utf8');
const local = convertLocal(content, DEFAULT_LOGSEQ_OPTIONS);
const index = new Map(local.ids.map(id => [id.uuid, { page: 'Foo', shortId: id.shortId }]));
let body = resolveBlockRefs(local.body, index);
body = rewriteAliasReferences(body, { aliasMap: new Map([['altfoo', 'Foo'], ['other', 'Foo']]) });
console.log('=== YAML ===');
console.log(local.yaml);
console.log('=== BODY ===');
console.log(body);
console.log('=== ASSETS ===', JSON.stringify(local.assets));
