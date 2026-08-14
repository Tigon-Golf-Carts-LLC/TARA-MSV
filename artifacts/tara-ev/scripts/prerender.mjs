#!/usr/bin/env node
/**
 * prerender.mjs — Static HTML pre-renderer for TARA EV SPA
 *
 * For each route in public/content/routes.json this script generates a
 * complete HTML file (proper <head> meta tags + the page content HTML
 * embedded in the body) and writes it into the Vite output directory:
 *
 *   <outDir>/<route-slug>/index.html
 *
 * IMPORTANT: the shell HTML must be the *already-built* index.html
 * (i.e. dist/public/index.html after `vite build`) so that the generated
 * files reference the hashed JS/CSS asset bundles, not the source
 * /src/main.tsx entry point.  Pass --shellHtml <path> to provide it.
 *
 * Usage:
 *   node scripts/prerender.mjs \
 *     --shellHtml <path-to-built-index.html> \
 *     --outDir    <output-directory> \
 *     --origin    <https://site-domain.com>
 *
 * On any error (missing files, assertion failures) the script exits with a
 * non-zero code so `vite build` fails loudly rather than silently shipping
 * broken prerendered pages.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(__dirname, '..');

// ─── CLI args ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function getArg(name) {
  const idx = argv.indexOf(name);
  return idx !== -1 ? argv[idx + 1] : null;
}

const shellHtmlPath =
  getArg('--shellHtml') ?? path.join(artifactDir, 'dist', 'public', 'index.html');
const outDir =
  getArg('--outDir') ?? path.join(artifactDir, 'dist', 'public');
const origin =
  getArg('--origin') ??
  (process.env.REPLIT_DOMAINS
    ? `https://${process.env.REPLIT_DOMAINS.split(',')[0].trim()}`
    : 'https://taramsv.com');

// ─── Validation ───────────────────────────────────────────────────────────────

if (!fs.existsSync(shellHtmlPath)) {
  console.error(
    `[prerender] ERROR: shell HTML not found at "${shellHtmlPath}".\n` +
      '  Run `vite build` before running this script, or pass --shellHtml <path>.',
  );
  process.exit(1);
}

const shellHtml = fs.readFileSync(shellHtmlPath, 'utf8');

// Assert that the shell references a compiled JS bundle (not the TS source).
// This catches the case where the script is accidentally pointed at the
// development index.html which still has <script src="/src/main.tsx">.
if (/src=["']\/src\/main\.tsx["']/.test(shellHtml)) {
  console.error(
    '[prerender] ERROR: The shell HTML still references /src/main.tsx.\n' +
      '  Pre-rendering requires the *built* dist/public/index.html, not the\n' +
      '  source index.html.  Run `vite build` first and pass --shellHtml to\n' +
      '  the correct path.',
  );
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Extract a ~160-character plain-text description from the content HTML.
 * Prefers the first non-trivial <p> whose text is clearly page content
 * (not a nav breadcrumb or a widget label).
 */
function extractDescription(html) {
  const cleaned = html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const pMatches = [...cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  for (const m of pMatches) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length < 50 || text.includes(' / ')) continue;
    return text.length > 158 ? text.slice(0, 157) + '…' : text;
  }

  const fallback = cleaned.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return fallback.length > 158 ? fallback.slice(0, 157) + '…' : fallback;
}

/**
 * Return the first product/hero image found in the content HTML,
 * skipping logos, menu thumbnails, and icons.
 */
function extractOgImage(html) {
  const SKIP = /logo|favicon|menu-image|icon/i;
  for (const m of html.matchAll(/src=["']([^"']+\.(?:webp|jpg|jpeg|png))["']/gi)) {
    const src = m[1];
    if (SKIP.test(src)) continue;
    if (src.startsWith('/images/') || src.startsWith('/uploads/')) return src;
  }
  return '/images/og-image.png';
}

// ─── Per-route HTML builder ───────────────────────────────────────────────────

function buildPageHtml(routePath, routeMeta, contentHtml) {
  const title = routeMeta.title || 'TARA Neighborhood Electric Vehicles';
  const description = extractDescription(contentHtml);
  const ogImage = extractOgImage(contentHtml);
  const canonicalUrl = `${origin}${routePath}`;
  const absoluteOgImage = ogImage.startsWith('http')
    ? ogImage
    : `${origin}${ogImage}`;

  let html = shellHtml;

  // Replace <title>
  html = html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escHtml(title)}</title>`,
  );

  // Replace generic meta description
  html = html.replace(
    /<meta\s+name="description"[^>]*\/?>/i,
    `<meta name="description" content="${escHtml(description)}" />`,
  );

  // Replace generic og:title
  html = html.replace(
    /<meta\s+property="og:title"[^>]*\/?>/i,
    `<meta property="og:title" content="${escHtml(title)}" />`,
  );

  // Replace generic og:description
  html = html.replace(
    /<meta\s+property="og:description"[^>]*\/?>/i,
    `<meta property="og:description" content="${escHtml(description)}" />`,
  );

  // Replace generic og:image
  html = html.replace(
    /<meta\s+property="og:image"[^>]*\/?>/i,
    `<meta property="og:image" content="${absoluteOgImage}" />`,
  );

  // Inject canonical + og:url before </head>
  const canonicalBlock = [
    `  <link rel="canonical" href="${canonicalUrl}" />`,
    `  <meta property="og:url" content="${canonicalUrl}" />`,
  ].join('\n');
  html = html.replace('</head>', `${canonicalBlock}\n</head>`);

  // Embed page content inside #root so crawlers that don't execute JS
  // still see the full page content, headings, product specs, and links.
  // Browsers load the React bundle (referenced in the built shell) and the
  // SPA re-renders, replacing this static content seamlessly.
  html = html.replace(
    '<div id="root"></div>',
    `<div id="root" data-prerendered="1">${contentHtml}</div>`,
  );

  return html;
}

// ─── Post-generation assertion ────────────────────────────────────────────────

/**
 * Verify that the generated HTML references at least one built JS asset
 * that actually exists in outDir/assets/.  Exits non-zero on failure.
 */
function assertJsAssetPresent(generatedHtml, routePath) {
  // The built shell should have something like: /assets/index-Abc123.js
  const match = generatedHtml.match(/src=["'](\/assets\/[^"']+\.js)["']/);
  if (!match) {
    console.error(
      `[prerender] ASSERTION FAILED for "${routePath}": generated HTML has no` +
        ' <script src="/assets/...js"> tag.  The shell may be stale or corrupt.',
    );
    process.exit(1);
  }
  // Confirm the referenced asset file actually exists on disk.
  const assetRel = match[1].replace(/^\//, ''); // strip leading /
  const assetPath = path.join(outDir, assetRel);
  if (!fs.existsSync(assetPath)) {
    console.error(
      `[prerender] ASSERTION FAILED for "${routePath}": referenced asset` +
        ` "${match[1]}" does not exist at "${assetPath}".`,
    );
    process.exit(1);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const routesPath = path.join(
    artifactDir,
    'public',
    'content',
    'routes.json',
  );
  if (!fs.existsSync(routesPath)) {
    console.error(`[prerender] ERROR: routes.json not found at "${routesPath}"`);
    process.exit(1);
  }

  const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));

  // Determine if the built assets directory exists so we can run the
  // JS-asset assertion (it won't exist in unit-test / dry-run contexts).
  const assetsDir = path.join(outDir, 'assets');
  const canAssert = fs.existsSync(assetsDir);

  let generated = 0;

  for (const [routePath, routeMeta] of Object.entries(routes)) {
    // Redirect-only routes have no content file to prerender; they are
    // handled as HTTP 301s by the server config.
    if (routeMeta.redirect || !routeMeta.file) continue;
    const contentFile = path.join(
      artifactDir,
      'public',
      'content',
      routeMeta.file,
    );
    if (!fs.existsSync(contentFile)) {
      // Hard failure — a missing content file means the prerender output
      // would be incomplete.  Fail the build so the gap is caught early.
      console.error(
        `[prerender] ERROR: content file missing for route "${routePath}": ${routeMeta.file}`,
      );
      process.exit(1);
    }

    const contentHtml = fs.readFileSync(contentFile, 'utf8');
    const pageHtml = buildPageHtml(routePath, routeMeta, contentHtml);

    // Validate the generated page references an existing JS bundle.
    if (canAssert) {
      assertJsAssetPresent(pageHtml, routePath);
    }

    // Write output: "/" → outDir/index.html, "/about-us/" → outDir/about-us/index.html
    const slug = routePath === '/' ? '' : routePath.replace(/^\/|\/$/g, '');
    const outFile = slug
      ? path.join(outDir, slug, 'index.html')
      : path.join(outDir, 'index.html');

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, pageHtml, 'utf8');
    generated++;
  }

  console.log(`[prerender] Generated ${generated} page(s) → ${outDir}`);
}

main().catch((err) => {
  console.error('[prerender] Fatal error:', err);
  process.exit(1);
});
