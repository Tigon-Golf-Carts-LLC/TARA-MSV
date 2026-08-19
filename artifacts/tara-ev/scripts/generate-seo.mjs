#!/usr/bin/env node
/** Generate portable sitemap and robots files from the local route snapshot. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(artifactDir, 'public');
const routes = JSON.parse(
  fs.readFileSync(path.join(publicDir, 'content', 'routes.json'), 'utf8'),
);

const siteDomain = (process.env.SITE_DOMAIN || 'https://taramsv.com').replace(
  /\/+$/,
  '',
);
const rawBase = process.env.BASE_PATH || '/';
const basePath = rawBase === '/' ? '' : `/${rawBase.replace(/^\/|\/$/g, '')}`;
const siteBase = `${siteDomain}${basePath}`;
const xmlEscape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const pagePaths = Object.entries(routes)
  .filter(([, meta]) => !meta.redirect && meta.file)
  .map(([routePath]) => routePath)
  .sort();

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...pagePaths.map(
    (routePath) =>
      `  <url><loc>${xmlEscape(`${siteBase}${routePath}`)}</loc></url>`,
  ),
  '</urlset>',
  '',
].join('\n');

const robots = [
  '# TARA Medium Speed Vehicles — static site',
  'User-agent: *',
  'Allow: /',
  '',
  `Sitemap: ${siteBase}/sitemap.xml`,
  '',
].join('\n');

fs.writeFileSync(path.join(publicDir, 'sitemap.xml'), sitemap);
fs.writeFileSync(path.join(publicDir, 'robots.txt'), robots);
console.log(`[generate-seo] Generated SEO files for ${pagePaths.length} pages`);