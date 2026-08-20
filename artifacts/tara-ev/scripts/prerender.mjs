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
 * (i.e. dist/index.html after `vite build`) so that the generated
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
  getArg('--shellHtml') ?? path.join(artifactDir, 'dist', 'index.html');
const outDir =
  getArg('--outDir') ?? path.join(artifactDir, 'dist');
const siteDomain = (
  getArg('--origin') ??
  process.env.SITE_DOMAIN ??
  'https://taramsv.com'
).replace(/\/+$/, '');
const rawBasePath = getArg('--base') ?? process.env.BASE_PATH ?? '/';
const basePath =
  rawBasePath === '/' ? '/' : `/${rawBasePath.replace(/^\/|\/$/g, '')}/`;
const basePrefix = basePath === '/' ? '' : basePath.replace(/\/$/, '');
const siteBaseUrl = `${siteDomain}${basePrefix}`;

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
      '  Pre-rendering requires the *built* dist/index.html, not the\n' +
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

/**
 * Prefix root-relative paths for GitHub project sites and replace the removed
 * PHP search handler with Google site search. This is applied to prerendered
 * markup; App.tsx performs the equivalent transform after client rendering.
 */
/**
 * Conservative HTML minification. Only strips comments and collapses
 * whitespace-only runs between block boundaries — never touches whitespace that
 * separates inline elements, and never touches <pre>/<textarea>/<script>/<style>,
 * so the cloned theme renders byte-for-byte the same.
 */
function minifyHtml(html) {
  const guarded = [];
  const stash = html.replace(
    /<(pre|textarea|script|style)\b[\s\S]*?<\/\1>/gi,
    (m) => `\u0000${guarded.push(m) - 1}\u0000`,
  );
  const squeezed = stash
    // drop comments, keeping conditional comments and the clone's structural markers
    .replace(/<!--(?!\[if|<!)([\s\S]*?)-->/g, (m, body) =>
      /^\s*(\/?\s*(wp:|\/)|\[)/.test(body) ? m : '',
    )
    // collapse indentation and blank lines; a single newline is kept so inline
    // elements still get their separating whitespace
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n');
  return squeezed.replace(/\u0000(\d+)\u0000/g, (_m, i) => guarded[Number(i)]);
}

function makeContentStatic(html) {
  const urlAttributes = [
    'href',
    'src',
    'action',
    'poster',
    'data-src',
    'data-lazy-src',
    'data-original',
    'data-bg',
    'data-background',
  ].join('|');
  let result = html
    .replace(
      /<form(\s[^>]*)action=["']\/search\.php["']([^>]*)>/gi,
      '<form$1action="https://www.google.com/search"$2>',
    )
    .replace(/(<input\b[^>]*\bname=["'])s(["'][^>]*>)/gi, '$1q$2')
    .replace(
      /(<input\b[^>]*\bname=["'])cat(["'][^>]*\bvalue=["'])[^"']*(["'][^>]*>)/gi,
      '$1sitesearch$2taramsv.com$3',
    );

  if (!basePrefix) return result;

  result = result.replace(
    new RegExp(`\\b(${urlAttributes})=([\"'])/(?!/)`, 'gi'),
    (_match, attribute, quote) => `${attribute}=${quote}${basePrefix}/`,
  );
  result = result.replace(
    /\b(srcset|data-srcset)=(["'])([^"']*)\2/gi,
    (_match, attribute, quote, value) => {
      const nextValue = String(value)
        .split(',')
        .map((candidate) => {
          const [url, ...descriptor] = candidate.trim().split(/\s+/);
          return [
            url.startsWith('/') && !url.startsWith('//')
              ? `${basePrefix}${url}`
              : url,
            ...descriptor,
          ].join(' ');
        })
        .join(', ');
      return `${attribute}=${quote}${nextValue}${quote}`;
    },
  );
  result = result.replace(
    /url\((["']?)\/(?!\/)/gi,
    (_match, quote) => `url(${quote}${basePrefix}/`,
  );
  return result;
}

function walkFiles(directory, extension, visit) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(entryPath, extension, visit);
    } else if (entry.name.toLowerCase().endsWith(extension)) {
      visit(entryPath);
    }
  }
}

function postprocessCopiedStaticFiles() {
  walkFiles(path.join(outDir, 'content'), '.html', (htmlPath) => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    fs.writeFileSync(htmlPath, minifyHtml(makeContentStatic(html)), 'utf8');
  });

  if (basePrefix) {
    walkFiles(path.join(outDir, 'css'), '.css', (cssPath) => {
      const css = fs.readFileSync(cssPath, 'utf8').replace(
        /url\((["']?)\/(?!\/)/gi,
        (_match, quote) => `url(${quote}${basePrefix}/`,
      );
      fs.writeFileSync(cssPath, css, 'utf8');
    });
  }
}

function assertProjectBasePaths() {
  if (!basePrefix) return;
  const htmlUrls =
    /\b(?:href|src|action|poster|data-src|data-lazy-src|data-original|data-bg|data-background|srcset|data-srcset)=(["'])(\/(?!\/)[^"']*)\1/gi;
  const cssUrls = /url\((["']?)(\/(?!\/)[^)"']*)\1\)/gi;

  walkFiles(outDir, '.html', (htmlPath) => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const leak = [...html.matchAll(htmlUrls)].find(
      (match) => !match[2].startsWith(`${basePrefix}/`),
    );
    if (leak) {
      throw new Error(
        `[prerender] Unprefixed project-base URL "${leak[2]}" remains in ${htmlPath}`,
      );
    }
  });
  walkFiles(path.join(outDir, 'css'), '.css', (cssPath) => {
    const css = fs.readFileSync(cssPath, 'utf8');
    const leak = [...css.matchAll(cssUrls)].find(
      (match) => !match[2].startsWith(`${basePrefix}/`),
    );
    if (leak) {
      throw new Error(
        `[prerender] Unprefixed project-base CSS URL "${leak[2]}" remains in ${cssPath}`,
      );
    }
  });
}

// ─── Per-route HTML builder ───────────────────────────────────────────────────

function buildPageHtml(routePath, routeMeta, contentHtml) {
  const title = routeMeta.title || 'TARA Medium Speed Vehicles';
  const description =
    routeMeta.description || extractDescription(contentHtml);
  const ogImage = extractOgImage(contentHtml);
  const canonicalUrl = `${siteBaseUrl}${routePath}`;
  const absoluteOgImage = ogImage.startsWith('http')
    ? ogImage
    : `${siteBaseUrl}${ogImage}`;
  const staticContentHtml = makeContentStatic(contentHtml);

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
  html = html.replace(
    /<meta\s+name="twitter:title"[^>]*\/?>/i,
    `<meta name="twitter:title" content="${escHtml(title)}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:description"[^>]*\/?>/i,
    `<meta name="twitter:description" content="${escHtml(description)}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:image"[^>]*\/?>/i,
    `<meta name="twitter:image" content="${absoluteOgImage}" />`,
  );

  html = html.replace(
    /<link\s+rel="canonical"[^>]*\/?>/i,
    `<link rel="canonical" href="${canonicalUrl}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:url"[^>]*\/?>/i,
    `<meta property="og:url" content="${canonicalUrl}" />`,
  );

  // Embed page content inside #root so crawlers that don't execute JS
  // still see the full page content, headings, product specs, and links.
  // Browsers load the React bundle (referenced in the built shell) and the
  // SPA re-renders, replacing this static content seamlessly.
  html = html.replace(
    '<div id="root"></div>',
    `<div id="root" data-prerendered="1">${staticContentHtml}</div>`,
  );

  return html;
}

// ─── Post-generation assertion ────────────────────────────────────────────────

/**
 * Verify that the generated HTML references at least one built JS asset
 * that actually exists in outDir/assets/.  Exits non-zero on failure.
 */
function assertJsAssetPresent(generatedHtml, routePath) {
  // The built shell should have /assets/... or /<repo>/assets/... .
  const match = generatedHtml.match(
    /src=["']([^"']*\/assets\/[^"']+\.js)["']/,
  );
  if (!match) {
    console.error(
      `[prerender] ASSERTION FAILED for "${routePath}": generated HTML has no` +
        ' <script src="/assets/...js"> tag.  The shell may be stale or corrupt.',
    );
    process.exit(1);
  }
  // Confirm the referenced asset file actually exists on disk.
  let assetRel = match[1].replace(/^\//, '');
  if (basePrefix && assetRel.startsWith(`${basePrefix.replace(/^\//, '')}/`)) {
    assetRel = assetRel.slice(basePrefix.replace(/^\//, '').length + 1);
  }
  const assetPath = path.join(outDir, assetRel);
  if (!fs.existsSync(assetPath)) {
    console.error(
      `[prerender] ASSERTION FAILED for "${routePath}": referenced asset` +
        ` "${match[1]}" does not exist at "${assetPath}".`,
    );
    process.exit(1);
  }
}

function buildRedirectHtml(routePath, targetPath) {
  const target = `${basePrefix}${targetPath}`;
  const canonicalUrl = `${siteBaseUrl}${targetPath}`;
  let html = shellHtml;
  html = html.replace(
    /<title>[^<]*<\/title>/,
    '<title>Redirecting… | TARA Medium Speed Vehicles</title>',
  );
  html = html.replace(
    '</head>',
    `  <link rel="canonical" href="${canonicalUrl}" />\n` +
      `  <meta http-equiv="refresh" content="0;url=${target}" />\n` +
      `  <script>window.location.replace(${JSON.stringify(target)});</script>\n` +
      '</head>',
  );
  html = html.replace(
    '<div id="root"></div>',
    `<div id="root"><p>Redirecting to <a href="${target}">${target}</a>…</p></div>`,
  );
  return html;
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
  postprocessCopiedStaticFiles();

  // Determine if the built assets directory exists so we can run the
  // JS-asset assertion (it won't exist in unit-test / dry-run contexts).
  const assetsDir = path.join(outDir, 'assets');
  const canAssert = fs.existsSync(assetsDir);

  let generated = 0;

  for (const [routePath, routeMeta] of Object.entries(routes)) {
    if (routeMeta.redirect) {
      const redirectHtml = buildRedirectHtml(routePath, routeMeta.redirect);
      const redirectSlug = routePath.replace(/^\/|\/$/g, '');
      const redirectFile = path.join(outDir, redirectSlug, 'index.html');
      fs.mkdirSync(path.dirname(redirectFile), { recursive: true });
      fs.writeFileSync(redirectFile, redirectHtml, 'utf8');
      generated++;
      continue;
    }
    if (!routeMeta.file) {
      console.error(`[prerender] ERROR: route "${routePath}" has no content file`);
      process.exit(1);
    }
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
    const pageHtml = minifyHtml(buildPageHtml(routePath, routeMeta, contentHtml));

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

  // GitHub Pages deep-link fallback and static-host control files.
  fs.copyFileSync(
    path.join(outDir, 'index.html'),
    path.join(outDir, '404.html'),
  );
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '', 'utf8');

  const manifestPath = path.join(outDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.start_url = basePath;
    manifest.icons = (manifest.icons || []).map((icon) => ({
      ...icon,
      src:
        typeof icon.src === 'string' &&
        icon.src.startsWith('/') &&
        !icon.src.startsWith('//')
          ? `${basePrefix}${icon.src}`
          : icon.src,
    }));
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  // routes.json is a build-time authoring source; the client reads the
  // minified site-snapshot.json instead, so keep 277 KB out of the artifact.
  const builtRoutes = path.join(outDir, 'content', 'routes.json');
  if (fs.existsSync(builtRoutes)) fs.rmSync(builtRoutes);

  const cnameSource = path.join(artifactDir, 'CNAME');
  if (fs.existsSync(cnameSource)) {
    fs.copyFileSync(cnameSource, path.join(outDir, 'CNAME'));
  }

  assertProjectBasePaths();
  console.log(`[prerender] Generated ${generated} page(s) → ${outDir}`);
}

main().catch((err) => {
  console.error('[prerender] Fatal error:', err);
  process.exit(1);
});
