/**
 * Every importer loads without the plugin.
 *
 * A conversion is only testable if its module can be reached from a test, and
 * an importer reaching main.ts cannot be: main.ts extends Plugin and pulls in
 * the dialog and all fourteen importers, none of which exist under the shim.
 *
 * Nothing else notices when that breaks. Typecheck and lint both pass on an
 * import that only fails at load, so without this the next `import { x } from
 * '../main'` goes green and the graph is quietly unloadable again - surfacing
 * whenever someone next tries to write an importer test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

import '../shims/dom';
import '../shims/runtime';

const FORMATS = nodePath.join(__dirname, '..', '..', 'src', 'formats');

const entryPoints = nodeFs.readdirSync(FORMATS)
	.filter(name => name.endsWith('.ts'))
	.sort((a, b) => a.localeCompare(b));

test('there are importers to check', () => {
	// Guards against the filter silently matching nothing and the suite below
	// passing by having no cases at all
	assert.ok(entryPoints.length >= 10, `found only ${entryPoints.length} importer entry points`);
});

for (const name of entryPoints) {
	test(`${name} loads without the plugin`, async () => {
		// A bare specifier, or an import of main.ts, throws here rather than
		// failing the whole run at collection time
		await assert.doesNotReject(() => import(nodePath.join(FORMATS, name)));
	});
}
