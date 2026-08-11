/**
 * The website build.
 *
 * The one thing that makes this work is the alias: `obsidian` is a type-only
 * package, so every import of it in src resolves to web/obsidian/index.ts
 * instead - the same trick tsconfig.test.json plays to run the importers under
 * node. Unlike the plugin build, zip.js is not cut down to inflate: the
 * website has to write a zip as well as read one.
 */
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import process from 'process';
import http from 'http';

const root = path.dirname(new URL(import.meta.url).pathname);
const outdir = path.join(root, 'dist');

const serve = process.argv.includes('serve');
const prod = process.argv.includes('production');

const STATIC = ['index.html', 'style.css'];

function copyStatic() {
	fs.mkdirSync(outdir, { recursive: true });
	for (const file of STATIC) {
		fs.copyFileSync(path.join(root, file), path.join(outdir, file));
	}
}

/** Copied on every build, so an edit to the page is picked up by the watch too. */
const staticPlugin = {
	name: 'copy-static',
	setup(build) {
		build.onEnd(copyStatic);
	},
};

const context = await esbuild.context({
	plugins: [staticPlugin],
	entryPoints: [path.join(root, 'app.ts')],
	bundle: true,
	format: 'iife',
	target: 'es2020',
	platform: 'browser',
	alias: {
		obsidian: path.join(root, 'obsidian', 'index.ts'),
	},
	// Reached only by importers that read a real disk, which the website does
	// not offer. Stubbed so the bundle resolves rather than fails at build.
	external: ['node:*'],
	sourcemap: prod ? false : 'inline',
	minify: prod,
	logLevel: 'info',
	outfile: path.join(outdir, 'app.js'),
});

copyStatic();

if (!serve) {
	await context.rebuild();
	await context.dispose();
	process.exit(0);
}

{
	await context.watch();

	const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };
	const port = Number(process.env.PORT ?? 8123);

	http.createServer((req, res) => {
		const name = (req.url ?? '/').split('?')[0];
		const file = path.join(outdir, name === '/' ? 'index.html' : path.normalize(name).replace(/^(\.\.[/\\])+/, ''));

		fs.readFile(file, (err, body) => {
			if (err) {
				res.writeHead(404).end('Not found');
				return;
			}
			res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' }).end(body);
		});
	// 0.0.0.0 so another device on the network - a phone over Tailscale - can reach it.
	}).listen(port, '0.0.0.0', () => console.log(`Serving ${outdir} on http://0.0.0.0:${port}`));
}
