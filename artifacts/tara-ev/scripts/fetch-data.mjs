#!/usr/bin/env node
/**
 * Build-time data snapshot.
 *
 * The site has no runtime API and no database: every route's metadata and page
 * body already live under public/content. This script validates that snapshot
 * and emits the *runtime* route map the SPA shell fetches on boot.
 *
 * routes.json is the authoring source (pretty-printed, carries the per-route
 * descriptions that prerender bakes into <head>). site-snapshot.json is the
 * shipped artifact: minified, and carrying only the fields the client reads at
 * runtime. Descriptions are deliberately dropped — every route is prerendered
 * with its own <head>, and navigation is a full page load, so the client never
 * needs to patch a description in.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.join(artifactDir, 'public', 'content');
const routesPath = path.join(contentDir, 'routes.json');
const snapshotPath = path.join(contentDir, 'site-snapshot.json');

const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
const runtime = {};
let pages = 0;
let redirects = 0;

for (const [routePath, meta] of Object.entries(routes)) {
  if (meta.redirect) {
    runtime[routePath] = { redirect: meta.redirect };
    redirects++;
    continue;
  }
  if (!meta.file) {
    throw new Error(`Route ${routePath} has neither a content file nor a redirect`);
  }
  const contentPath = path.join(contentDir, meta.file);
  if (!fs.existsSync(contentPath)) {
    throw new Error(`Missing snapshot content for ${routePath}: ${meta.file}`);
  }
  const entry = { file: meta.file, title: meta.title };
  if (meta.bodyClass) entry.bodyClass = meta.bodyClass;
  runtime[routePath] = entry;
  pages++;
}

// Minified on purpose — this file is fetched by every visitor on first paint.
const snapshot = JSON.stringify(runtime) + '\n';

if (!fs.existsSync(snapshotPath) || fs.readFileSync(snapshotPath, 'utf8') !== snapshot) {
  fs.writeFileSync(snapshotPath, snapshot);
}

console.log(
  `[fetch-data] Validated ${pages} pages + ${redirects} redirects → ` +
    `site-snapshot.json (${(Buffer.byteLength(snapshot) / 1024).toFixed(0)} KB, ` +
    `was ${(fs.statSync(routesPath).size / 1024).toFixed(0)} KB pretty)`,
);
