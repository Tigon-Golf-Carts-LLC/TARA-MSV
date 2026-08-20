#!/usr/bin/env node
/**
 * verify-dist.mjs — post-build gate for the GitHub Pages artifact.
 *
 * Fails the build loudly when dist/ is missing something Pages needs, when a
 * file is too big to host, or when a same-origin API call, a localhost URL, or
 * a known secret name leaked into the bundle.
 *
 * Usage: node scripts/verify-dist.mjs [--dist <path>] [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const artifactDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const argv = process.argv.slice(2);
const distDir = path.resolve(
  argv.includes('--dist') ? argv[argv.indexOf('--dist') + 1] : path.join(artifactDir, 'dist'),
);

const MAX_FILE_BYTES = 25 * 1024 * 1024; // fail well before the 100 MB Pages cap
const HARD_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const WARN_FILE_BYTES = 1024 * 1024;

const REQUIRED = [
  'index.html',
  '404.html',
  '.nojekyll',
  'sitemap.xml',
  'robots.txt',
  'content/site-snapshot.json',
];
// Route folders that must exist as real, directly-linkable HTML.
const REQUIRED_ROUTES = ['about-us', 'contact', 'fleet-golf-carts'];

const SECRET_NAMES = [
  'GITHUB_TOKEN',
  'NPM_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'DATABASE_URL',
  'SESSION_SECRET',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'STRIPE_SECRET_KEY',
  'SENDGRID_API_KEY',
  'REPLIT_DB_URL',
];

const errors = [];
const warnings = [];

if (!fs.existsSync(distDir)) {
  console.error(`[verify-dist] FAIL: dist not found at ${distDir}`);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const files = walk(distDir);
const sized = files
  .map((f) => ({ file: path.relative(distDir, f), bytes: fs.statSync(f).size }))
  .sort((a, b) => b.bytes - a.bytes);
const total = sized.reduce((n, f) => n + f.bytes, 0);

// ─── required files ───────────────────────────────────────────────────────────

for (const rel of REQUIRED) {
  if (!fs.existsSync(path.join(distDir, rel))) errors.push(`missing ${rel}`);
}
for (const route of REQUIRED_ROUTES) {
  if (!fs.existsSync(path.join(distDir, route, 'index.html'))) {
    errors.push(`missing prerendered route ${route}/index.html`);
  }
}
const routeDirs = files.filter((f) => /(^|[\\/])index\.html$/.test(f)).length;
if (routeDirs < 100) {
  errors.push(`only ${routeDirs} prerendered index.html files — expected the full route set`);
}

// ─── size gates ───────────────────────────────────────────────────────────────

for (const f of sized) {
  if (f.bytes > HARD_FILE_BYTES) errors.push(`${f.file} is ${(f.bytes / 1048576).toFixed(1)} MB — over the 100 MB GitHub Pages hard cap`);
  else if (f.bytes > MAX_FILE_BYTES) errors.push(`${f.file} is ${(f.bytes / 1048576).toFixed(1)} MB — over the 25 MB budget`);
  else if (f.bytes > WARN_FILE_BYTES) warnings.push(`${f.file} is ${(f.bytes / 1048576).toFixed(2)} MB (over 1 MB)`);
}
if (total > MAX_TOTAL_BYTES) {
  errors.push(`dist total is ${(total / 1048576).toFixed(0)} MB — over the 500 MB budget`);
}

// ─── leak scan across every text asset ────────────────────────────────────────

const TEXT_EXT = new Set(['.html', '.js', '.css', '.json', '.xml', '.txt', '.map', '.webmanifest', '.jsonld']);
const leaks = { localhost: [], api: [], secrets: [] };

for (const f of files) {
  if (!TEXT_EXT.has(path.extname(f).toLowerCase())) continue;
  const rel = path.relative(distDir, f);
  const text = fs.readFileSync(f, 'utf8');

  if (/\blocalhost\b|\b127\.0\.0\.1\b|\b0\.0\.0\.0\b/.test(text)) leaks.localhost.push(rel);

  // A same-origin API call is what breaks a static host. Match fetch/XHR/axios
  // targets and href/src/action attributes pointing at /api/, not prose.
  const apiRe =
    /(?:fetch\(|axios(?:\.\w+)?\(|\.open\(\s*["'][A-Z]+["']\s*,\s*|(?:href|src|action)\s*=\s*)["'`](\/api\/[^"'`]*)/g;
  const hits = [...text.matchAll(apiRe)].map((m) => m[1]);
  if (hits.length) leaks.api.push(`${rel}: ${[...new Set(hits)].slice(0, 3).join(', ')}`);

  for (const name of SECRET_NAMES) {
    if (text.includes(name)) leaks.secrets.push(`${rel}: ${name}`);
  }
}

if (leaks.localhost.length) errors.push(`localhost/loopback URL in: ${leaks.localhost.slice(0, 5).join(', ')}`);
if (leaks.api.length) errors.push(`same-origin /api/ call in: ${leaks.api.slice(0, 5).join(', ')}`);
if (leaks.secrets.length) errors.push(`secret name in bundle: ${leaks.secrets.slice(0, 5).join(', ')}`);

// ─── image format check ───────────────────────────────────────────────────────

const imageFiles = sized.filter((f) => f.file.startsWith('images' + path.sep) || f.file.startsWith('images/'));
const byExt = {};
for (const f of imageFiles) {
  const e = path.extname(f.file).toLowerCase() || '(none)';
  byExt[e] = (byExt[e] || { n: 0, bytes: 0 });
  byExt[e].n++;
  byExt[e].bytes += f.bytes;
}
// Browser icons, the PWA manifest icon, og:image and the schema.org logo keep
// their original format on purpose — see KEEP_FORMAT in optimize-assets.mjs.
const INTENTIONAL_LEGACY = new Set([
  'images/favicon.png',
  'images/apple-touch-icon.png',
  'images/og-image.png',
  'images/tara-nev-logo.png',
]);
const legacy = imageFiles.filter(
  (f) =>
    ['.jpg', '.jpeg', '.png'].includes(path.extname(f.file).toLowerCase()) &&
    !INTENTIONAL_LEGACY.has(f.file.split(path.sep).join('/')),
);
if (legacy.length > 0) {
  warnings.push(
    `${legacy.length} unconverted JPEG/PNG under dist/images: ${legacy.slice(0, 5).map((f) => f.file).join(', ')}`,
  );
}
const withSrcset = fs
  .readFileSync(path.join(distDir, 'index.html'), 'utf8')
  .match(/srcset=/g)?.length ?? 0;
if (withSrcset === 0) errors.push('home page ships no srcset — responsive images are not wired up');

// ─── report ───────────────────────────────────────────────────────────────────

console.log('');
console.log(`[verify-dist] dist: ${distDir}`);
console.log(`[verify-dist] total: ${(total / 1048576).toFixed(1)} MB across ${files.length} files`);
console.log(`[verify-dist] prerendered pages: ${routeDirs}`);
console.log(`[verify-dist] images by format: ${Object.entries(byExt).map(([e, v]) => `${e} ${v.n} (${(v.bytes / 1048576).toFixed(1)} MB)`).join(', ') || 'none'}`);
console.log('');
console.log('20 largest files:');
for (const f of sized.slice(0, 20)) {
  console.log(`  ${(f.bytes / 1048576).toFixed(2).padStart(8)} MB  ${f.file}`);
}

if (warnings.length) {
  console.log('');
  console.log(`Warnings (${warnings.length}):`);
  for (const w of warnings.slice(0, 25)) console.log(`  ! ${w}`);
  if (warnings.length > 25) console.log(`  … ${warnings.length - 25} more`);
}

if (errors.length) {
  console.error('');
  console.error(`[verify-dist] FAILED with ${errors.length} error(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log('');
console.log('[verify-dist] OK — dist is ready for GitHub Pages');
