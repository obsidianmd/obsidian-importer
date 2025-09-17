#!/usr/bin/env node
/**
 * Wrapper to run governance tools from the public repo.
 * It attempts to resolve the governance path from multiple locations:
 *  - ../governance/obsidian-importer (local mono layout)
 *  - ./governance/obsidian-importer (CI-cloned layout)
 *
 * Usage:
 *   node scripts/run-governance-tool.mjs <runner> <scriptFile>
 *     <runner>: "ts" (tsx) or "js" (node)
 *     <scriptFile>: file within governance scripts dir, e.g. "check-pr-body.ts"
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const [,, runner, scriptFile, ...rest] = process.argv;
if (!runner || !scriptFile) {
  console.error('Usage: node scripts/run-governance-tool.mjs <runner: ts|js> <scriptFile> [args...]');
  process.exit(2);
}

const candidates = [
  // standard spelling
  path.resolve(process.cwd(), '../governance/obsidian-importer'),
  path.resolve(process.cwd(), './governance/obsidian-importer'),
  // alternate spelling per CI layout request
  path.resolve(process.cwd(), '../gorvernance/obsidian-importer'),
  path.resolve(process.cwd(), './gorvernance/obsidian-importer'),
  // explicit override
  process.env.GOV_PATH ? path.resolve(process.cwd(), process.env.GOV_PATH) : null,
].filter(Boolean);

let base = null;
for (const c of candidates) {
  if (fs.existsSync(path.join(c, 'scripts'))) {
    base = c;
    break;
  }
}

if (!base) {
  const requireGov = process.env.REQUIRE_GOV === '1';
  const msg = 'Governance path not found. Set GOV_PATH or clone to ./governance/obsidian-importer';
  if (requireGov) {
    console.error(msg);
    process.exit(1);
  } else {
    console.log(msg + ' (non-fatal)');
    process.exit(0);
  }
}

const scriptPath = path.join(base, 'scripts', scriptFile);
const isTs = runner === 'ts';
const cmd = isTs ? 'npx' : 'node';
const args = isTs ? ['--yes', 'tsx', scriptPath, ...rest] : [scriptPath, ...rest];

const res = spawnSync(cmd, args, { stdio: 'inherit' });
process.exit(res.status ?? 1);
