/**
 * The things Obsidian installs into the JavaScript runtime.
 *
 * The app adds these to the built-in prototypes, so conversion code uses them
 * as if they were standard. Anything hosting this code outside Obsidian - a
 * browser tool as much as a test - has to provide them.
 *
 * Import for side effects. tests/shims/dom.ts pulls this in too, so a test
 * that needs a DOM only has to import that one.
 */

Object.defineProperty(Object, 'isEmpty', {
	value: (object: Record<string, unknown>) => Object.keys(object).length === 0,
	writable: true, configurable: true,
});

for (const [proto, name, value] of [
	[Array.prototype, 'contains', function (this: unknown[], target: unknown) { return this.includes(target); }],
	[Array.prototype, 'remove', function (this: unknown[], target: unknown) {
		const index = this.indexOf(target);
		if (index > -1) this.splice(index, 1);
	}],
	[Array.prototype, 'first', function (this: unknown[]) { return this.length ? this[0] : undefined; }],
	[Array.prototype, 'last', function (this: unknown[]) { return this.length ? this[this.length - 1] : undefined; }],
	[String.prototype, 'contains', function (this: string, target: string) { return this.includes(target); }],
] as [object, string, unknown][]) {
	Object.defineProperty(proto, name, { value, writable: true, configurable: true, enumerable: false });
}
