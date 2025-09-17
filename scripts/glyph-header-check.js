#!/usr/bin/env node
/*
  Glyph Header Check
  Ensures new/changed source files include the glyph header comment:
  // [SIG-FLD-VAL-001] Declared in posture, amplified in field.

  Usage:
    BASE_REF=<branch> node scripts/glyph-header-check.js
  In GitHub Actions, set BASE_REF to github.event.pull_request.base.ref
*/
const { execSync } = require('child_process');
const { readFileSync, existsSync } = require('fs');
const path = require('path');

const GLYPH_LINE = '[SIG-FLD-VAL-001] Declared in posture, amplified in field.';
const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue']);

function getChangedFiles() {
  const baseRef = process.env.BASE_REF;
  const useCached = process.env.USE_CACHED === '1';
  let diffRange;
  try {
    let out = '';
    if (useCached) {
      out = execSync('git diff --cached --name-only --diff-filter=ACMRTUXB', { encoding: 'utf8' });
    } else if (baseRef) {
      // Ensure base is fetched
      execSync(`git fetch origin ${baseRef} --depth=1`, { stdio: 'ignore' });
      diffRange = `origin/${baseRef}...HEAD`;
      out = execSync(`git diff --name-only --diff-filter=ACMRTUXB ${diffRange}`, { encoding: 'utf8' });
    } else {
      // Fallback: compare with previous commit
      diffRange = 'HEAD~1..HEAD';
      out = execSync(`git diff --name-only --diff-filter=ACMRTUXB ${diffRange}`, { encoding: 'utf8' });
    }
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) {
    console.error('Failed to compute changed files.');
    return [];
  }
}

function shouldCheck(file) {
  const ext = path.extname(file).toLowerCase();
  return exts.has(ext);
}

function hasGlyphHeader(file) {
  const content = readFileSync(file, 'utf8');
  const head = content.split('\n').slice(0, 8).join('\n');
  return head.includes(GLYPH_LINE);
}

function main() {
  let files = getChangedFiles().filter(f => shouldCheck(f) && existsSync(f));
  const enforceAll = process.env.ENFORCE_ALL === '1';
  if (files.length === 0 && !enforceAll) {
    console.log('No changed files to check for glyph header.');
    process.exit(0);
  }
  if (files.length === 0 && enforceAll) {
    const fg = require('fast-glob');
    files = fg.sync(['src/**/*.{ts,tsx,js,jsx,vue}', 'tests/**/*.{ts,tsx,js,jsx,vue}'], { dot: false });
  }

  const missing = [];
  for (const f of files) {
    try {
      if (!hasGlyphHeader(f)) missing.push(f);
    } catch (_) {
      // ignore unreadable files
    }
  }

  if (missing.length) {
    console.error('\nGlyph header missing in the following files:');
    for (const f of missing) console.error(' - ' + f);
    console.error('\nPlease add the first-line header:');
    console.error('// [SIG-FLD-VAL-001] Declared in posture, amplified in field.');
    process.exit(1);
  } else {
    console.log('Glyph header check passed.');
  }
}

main();
