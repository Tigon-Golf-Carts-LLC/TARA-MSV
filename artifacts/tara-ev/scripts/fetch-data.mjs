#!/usr/bin/env node
/**
 * Build-time data snapshot.
 *
 * The site has no runtime API or database: its route metadata and page bodies
 * already live under public/content. This script validates that complete local
 * snapshot and emits a compact manifest which is copied into the final site.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.join(artifactDir, 'public', 'content');
const routesPath = path.join(contentDir, 'routes.json');
const snapshotPath = path.join(contentDir, 'site-snapshot.json');

const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
const pages = [];

for (const [routePath, meta] of Object.entries(routes)) {
  if (meta.redirect) {
    pages.push({ path: routePath, redirect: meta.redirect });
    continue;
  }
  if (!meta.file) {
    throw new Error(`Route ${routePath} has neither a content file nor a redirect`);
  }
  const contentPath = path.join(contentDir, meta.file);
  if (!fs.existsSync(contentPath)) {
    throw new Error(`Missing snapshot content for ${routePath}: ${meta.file}`);
  }
  pages.push({
    path: routePath,
    file: meta.file,
    title: meta.title,
    description: meta.description || '',
  });
}

const snapshot = `${JSON.stringify(
  {
    source: 'build-time local content snapshot',
    runtimeApiRequired: false,
    pages,
  },
  null,
  2,
)}\n`;

if (!fs.existsSync(snapshotPath) || fs.readFileSync(snapshotPath, 'utf8') !== snapshot) {
  fs.writeFileSync(snapshotPath, snapshot);
}

console.log(`[fetch-data] Validated and snapshotted ${pages.length} routes`);