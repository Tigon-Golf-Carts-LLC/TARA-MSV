#!/usr/bin/env node
/**
 * optimize-assets.mjs — build-time image pipeline.
 *
 *   assets-src/images/**   (originals, committed, never deployed)
 *        │
 *        ├─ sharp: auto-orient, strip EXIF, downscale to MAX_WIDTH,
 *        │         re-encode to WebP at every responsive breakpoint
 *        ├─ svgo:  minify SVG
 *        ▼
 *   public/images/**       (derivatives, generated + gitignored, copied into dist by Vite)
 *   assets-manifest.json   (committed: original path → derivative set)
 *
 * A second phase rewrites every `<img>` in public/content/*.html — plus the
 * image URLs in the sitemaps/feeds/schema — to point at the derivatives, adding
 * srcset/sizes/width/height/loading/decoding. Both phases are idempotent: the
 * manifest resolves original *and* derivative URLs, so re-running is a no-op.
 *
 * Only WebP is emitted. AVIF would need `<picture>` wrapping, which changes the
 * DOM that this cloned WordPress theme's CSS and jQuery depend on — see README.
 *
 * Usage: node scripts/optimize-assets.mjs [--force] [--concurrency N]
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { optimize as svgoOptimize } from 'svgo';

const artifactDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const SRC_DIR = path.join(artifactDir, 'assets-src', 'images');
const OUT_DIR = path.join(artifactDir, 'public', 'images');
const CONTENT_DIR = path.join(artifactDir, 'public', 'content');
const MANIFEST_PATH = path.join(artifactDir, 'assets-manifest.json');

// Bump when encoder settings change so cached derivatives are regenerated.
const PIPELINE_VERSION = 3;

// Measured on this asset set: a 2000px cap with a 400/800/1200/1600 ladder at
// q80 produces a 526 MB dist — past the size gate in verify-dist.mjs. Capping
// at 1600 (the widest the layout ever paints) at q76 lands near 290 MB with no
// visible quality loss.
const MAX_WIDTH = 1600;
const BREAKPOINTS = [400, 800, 1200];
const MIN_SRCSET_WIDTH = 400; // below this a single file is enough
const WEBP = { quality: 76, effort: 4, smartSubsample: true };
const DEFAULT_SIZES =
  '(max-width: 640px) 100vw, (max-width: 1024px) 90vw, 1200px';

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const CONCURRENCY = Number(
  argv[argv.indexOf('--concurrency') + 1] || Math.max(2, os.cpus().length),
);

sharp.cache(false);
sharp.concurrency(1); // we parallelise across files instead

// ─── helpers ──────────────────────────────────────────────────────────────────

const RASTER = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const PASSTHROUGH = new Set(['.ico']);

/**
 * Assets that must keep their original format and URL. Browser icon links,
 * PWA manifest icons, og:image and the schema.org logo are all consumed by
 * clients that either declare a MIME type or have patchy WebP support, so these
 * get re-encoded in place instead of being converted.
 */
const KEEP_FORMAT = new Set([
  '/images/favicon.png',
  '/images/apple-touch-icon.png',
  '/images/og-image.png',
  '/images/tara-nev-logo.png',
]);

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const relKey = (abs) =>
  '/images/' + path.relative(SRC_DIR, abs).split(path.sep).join('/');

function hashFile(abs) {
  return crypto
    .createHash('sha1')
    .update(fs.readFileSync(abs))
    .update(String(PIPELINE_VERSION))
    .digest('hex')
    .slice(0, 16);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

// ─── phase 1: encode derivatives ──────────────────────────────────────────────

/**
 * Two sources can share a stem (`foo.png` + `foo.webp` are the same artwork in
 * this mirror). They collapse onto one derivative; the larger source wins.
 */
function planOutputs(sources) {
  const byStem = new Map();
  for (const abs of sources) {
    const ext = path.extname(abs).toLowerCase();
    if (!RASTER.has(ext) || KEEP_FORMAT.has(relKey(abs))) continue;
    const stem = relKey(abs).replace(/\.[^./]+$/, '');
    const size = fs.statSync(abs).size;
    const prev = byStem.get(stem);
    if (!prev || size > prev.size) {
      if (prev) prev.aliasOf = stem;
      byStem.set(stem, { abs, size, stem });
    }
  }
  return byStem;
}

async function encodeOne(job) {
  const { abs, stem } = job;
  const outBase = path.join(OUT_DIR, stem.replace(/^\/images\//, ''));
  fs.mkdirSync(path.dirname(outBase), { recursive: true });

  const image = sharp(abs, { animated: true }).rotate(); // rotate() applies + drops EXIF
  const meta = await image.metadata();
  const animated = (meta.pages ?? 1) > 1;
  const natWidth = meta.width ?? 0;
  const natHeight = meta.height ?? 0;
  if (!natWidth || !natHeight) throw new Error(`no dimensions: ${abs}`);

  const capWidth = Math.min(natWidth, MAX_WIDTH);
  const scale = capWidth / natWidth;
  const capHeight = Math.max(1, Math.round(natHeight * scale));

  // Animated images keep a single frame set — resizing multi-frame webp/gif
  // per breakpoint is not worth the encode cost.
  const widths = animated
    ? [capWidth]
    : [...new Set([...BREAKPOINTS.filter((w) => w < capWidth), capWidth])].sort(
        (a, b) => a - b,
      );

  const variants = [];
  for (const w of widths) {
    const isBase = w === capWidth;
    const file = isBase ? `${outBase}.webp` : `${outBase}-w${w}.webp`;
    const buf = await sharp(abs, { animated })
      .rotate()
      .resize({ width: w, withoutEnlargement: true })
      .webp(WEBP)
      .toBuffer();
    await fsp.writeFile(file, buf);
    variants.push({
      url: '/images/' + path.relative(OUT_DIR, file).split(path.sep).join('/'),
      w,
      bytes: buf.length,
    });
  }

  return {
    src: variants[variants.length - 1].url,
    width: capWidth,
    height: capHeight,
    variants,
    srcset:
      capWidth >= MIN_SRCSET_WIDTH && variants.length > 1
        ? variants.map((v) => `${v.url} ${v.w}w`).join(', ')
        : null,
    bytesOut: variants.reduce((n, v) => n + v.bytes, 0),
  };
}

/** Re-encode in place: same path, same format, stripped metadata, crushed. */
async function optimizeInPlace(abs) {
  const key = relKey(abs);
  const out = path.join(OUT_DIR, key.replace(/^\/images\//, ''));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const ext = path.extname(abs).toLowerCase();
  let pipeline = sharp(abs).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true });
  pipeline =
    ext === '.png'
      ? pipeline.png({ compressionLevel: 9, palette: true, effort: 10 })
      : pipeline.jpeg({ quality: 82, mozjpeg: true });
  const buf = await pipeline.toBuffer();
  // Never let "optimization" make a file bigger.
  const original = await fsp.readFile(abs);
  const final = buf.length < original.length ? buf : original;
  await fsp.writeFile(out, final);
  const meta = await sharp(final).metadata();
  return { key, width: meta.width, height: meta.height, bytesOut: final.length };
}

async function optimizeSvg(abs) {
  const key = relKey(abs);
  const out = path.join(OUT_DIR, key.replace(/^\/images\//, ''));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const raw = await fsp.readFile(abs, 'utf8');
  const { data } = svgoOptimize(raw, {
    path: abs,
    multipass: true,
    plugins: ['preset-default', 'removeDimensions'],
  });
  await fsp.writeFile(out, data);
  return { src: key, bytesOut: Buffer.byteLength(data) };
}

async function runEncodePhase() {
  const sources = walk(SRC_DIR);
  if (!sources.length) {
    throw new Error(
      `[optimize-assets] No source images under ${SRC_DIR}. ` +
        'Originals live in assets-src/images and must be committed.',
    );
  }

  const prev =
    !FORCE && fs.existsSync(MANIFEST_PATH)
      ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
      : { images: {} };

  const plan = planOutputs(sources);
  const manifest = { version: PIPELINE_VERSION, sizes: DEFAULT_SIZES, images: {} };
  let bytesIn = 0;
  let bytesOut = 0;
  let encoded = 0;
  let cached = 0;

  const rasterJobs = [...plan.values()];
  const results = await mapLimit(rasterJobs, CONCURRENCY, async (job) => {
    const hash = hashFile(job.abs);
    const cachedEntry = prev.images?.[job.stem + '__meta'];
    const outputsExist =
      cachedEntry &&
      cachedEntry.hash === hash &&
      cachedEntry.variants.every((v) =>
        fs.existsSync(path.join(OUT_DIR, v.url.replace(/^\/images\//, ''))),
      );
    if (outputsExist) {
      cached++;
      return { job, hash, ...cachedEntry };
    }
    encoded++;
    const res = await encodeOne(job);
    return { job, hash, ...res };
  });

  for (const r of results) {
    bytesIn += r.job.size;
    bytesOut += r.bytesOut;
    manifest.images[r.job.stem + '__meta'] = {
      hash: r.hash,
      src: r.src,
      width: r.width,
      height: r.height,
      variants: r.variants,
      srcset: r.srcset,
      bytesOut: r.bytesOut,
    };
  }

  // Every original path (any extension) resolves to its derivative, and so does
  // every derivative URL — that is what makes the rewrite phase idempotent.
  const lookup = {};
  for (const abs of sources) {
    const ext = path.extname(abs).toLowerCase();
    if (!RASTER.has(ext)) continue;
    const stem = relKey(abs).replace(/\.[^./]+$/, '');
    const meta = manifest.images[stem + '__meta'];
    if (!meta) continue;
    lookup[relKey(abs)] = stem;
  }

  // Format-preserving assets (icons, og:image, logo)
  for (const abs of sources) {
    const key = relKey(abs);
    if (!KEEP_FORMAT.has(key)) continue;
    const r = await optimizeInPlace(abs);
    bytesIn += fs.statSync(abs).size;
    bytesOut += r.bytesOut;
    const stem = key.replace(/\.[^./]+$/, '');
    manifest.images[stem + '__meta'] = {
      hash: hashFile(abs),
      src: key,
      width: r.width,
      height: r.height,
      variants: [{ url: key, w: r.width, bytes: r.bytesOut }],
      srcset: null,
      bytesOut: r.bytesOut,
    };
    // Map the .webp name too, so a build that already rewrote these
    // references to .webp repairs itself on the next run.
    lookup[key] = stem;
    lookup[stem + '.webp'] = stem;
    // Drop the base *and* the responsive ladder left behind if this asset was
    // converted by an earlier pipeline version. The image cache is restored
    // across CI runs, so stale derivatives would otherwise ship forever.
    const strayDir = path.dirname(path.join(OUT_DIR, stem.replace(/^\/images\//, '')));
    const strayBase = path.basename(stem);
    if (fs.existsSync(strayDir)) {
      const strayRe = new RegExp(`^${strayBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-w\\d+)?\\.webp$`);
      for (const name of fs.readdirSync(strayDir)) {
        if (strayRe.test(name)) fs.rmSync(path.join(strayDir, name));
      }
    }
  }

  // SVG + passthrough assets
  for (const abs of sources) {
    const ext = path.extname(abs).toLowerCase();
    if (KEEP_FORMAT.has(relKey(abs))) continue;
    if (ext === '.svg') {
      const r = await optimizeSvg(abs);
      bytesIn += fs.statSync(abs).size;
      bytesOut += r.bytesOut;
      lookup[relKey(abs)] = null; // referenced as-is
    } else if (PASSTHROUGH.has(ext)) {
      const out = path.join(OUT_DIR, relKey(abs).replace(/^\/images\//, ''));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await fsp.copyFile(abs, out);
      bytesIn += fs.statSync(abs).size;
      bytesOut += fs.statSync(out).size;
      lookup[relKey(abs)] = null;
    }
  }

  for (const meta of Object.values(manifest.images)) {
    for (const v of meta.variants) {
      // Only mark a derivative as terminal when it is not also a source path.
      // A `.webp` original and its base derivative share a URL, and the source
      // mapping must win or that image never gets a srcset.
      if (!(v.url in lookup)) lookup[v.url] = null;
    }
  }
  manifest.lookup = lookup;

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest) + '\n');

  console.log(
    `[optimize-assets] ${rasterJobs.length} images (${encoded} encoded, ${cached} cached) ` +
      `${(bytesIn / 1048576).toFixed(1)} MB → ${(bytesOut / 1048576).toFixed(1)} MB ` +
      `(${(100 - (bytesOut / bytesIn) * 100).toFixed(1)}% smaller)`,
  );
  return manifest;
}

// ─── phase 2: rewrite markup + feeds to the derivatives ───────────────────────

function resolve(manifest, url) {
  if (!url) return null;
  const clean = url.split('?')[0].split('#')[0];
  const stem = manifest.lookup[clean];
  if (stem === undefined) return null;
  if (stem === null) return null; // svg / ico / already-a-derivative
  return manifest.images[stem + '__meta'] ?? null;
}

/** Rewrite one `<img …>` tag in place. */
function rewriteImgTag(tag, manifest) {
  const attr = (name) => {
    const m = tag.match(new RegExp(`\\b${name}=(["'])([\\s\\S]*?)\\1`, 'i'));
    return m ? m[2] : null;
  };
  const isLazySwiper = /\bdata-src=/.test(tag) && /swiper-lazy/.test(tag);
  const urlAttr = isLazySwiper ? 'data-src' : 'src';
  const entry = resolve(manifest, attr(urlAttr));
  if (!entry) return tag;

  let out = tag;
  const setAttr = (name, value) => {
    const re = new RegExp(`\\s${name}=(["'])[\\s\\S]*?\\1`, 'i');
    if (re.test(out)) out = out.replace(re, ` ${name}="${value}"`);
    else out = out.replace(/^<img/i, `<img ${name}="${value}"`);
  };
  const dropAttr = (name) => {
    out = out.replace(new RegExp(`\\s${name}=(["'])[\\s\\S]*?\\1`, 'ig'), '');
  };

  setAttr(urlAttr, entry.src);
  if (entry.srcset) {
    // Only markup that *declares* a wide width is treated as full-bleed. A
    // width this script filled in from the intrinsic size says nothing about
    // how wide the image actually paints, so it must not count.
    const authored =
      !/\bdata-intrinsic=/i.test(tag) &&
      !(
        attr('width') === String(entry.width) &&
        attr('height') === String(entry.height)
      );
    const fullBleed = authored && Number(attr('width')) >= 1200;
    setAttr(isLazySwiper ? 'data-srcset' : 'srcset', entry.srcset);
    setAttr('sizes', fullBleed ? '100vw' : manifest.sizes);
  } else {
    dropAttr(isLazySwiper ? 'data-srcset' : 'srcset');
    dropAttr('sizes');
  }

  // Intrinsic size stops layout shift. Only set when absent so hand-tuned
  // aspect ratios in the clone survive.
  if (!attr('width') && !attr('height')) {
    setAttr('width', String(entry.width));
    setAttr('height', String(entry.height));
    setAttr('data-intrinsic', '1'); // marks the size as ours, not the author's
  }

  // Anything not explicitly marked as the LCP image loads lazily — except site
  // chrome (the header logo, icons), which is above the fold on every page.
  const isChrome = KEEP_FORMAT.has(entry.src);
  if (isChrome || /\bfetchpriority=["']high["']/i.test(out)) {
    dropAttr('loading');
  } else if (!/\bloading=/i.test(out)) {
    setAttr('loading', 'lazy');
  }
  if (!/\bdecoding=/i.test(out)) setAttr('decoding', 'async');

  return out;
}

function rewriteHtml(html, manifest) {
  let changed = 0;
  const out = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const next = rewriteImgTag(tag, manifest);
    if (next !== tag) changed++;
    return next;
  });
  return { out, changed };
}

/** Plain URL substitution for feeds, sitemaps, schema and CSS. */
function rewriteUrls(text, manifest) {
  let changed = 0;
  const out = text.replace(
    /\/images\/[^\s"'()<>,\\]+?\.(?:webp|jpe?g|png|gif|bmp)/gi,
    (url) => {
      const entry = resolve(manifest, url);
      if (!entry || entry.src === url) return url;
      changed++;
      return entry.src;
    },
  );
  return { out, changed };
}

function runRewritePhase(manifest) {
  let files = 0;
  let imgs = 0;

  for (const file of walk(CONTENT_DIR)) {
    if (!file.endsWith('.html')) continue;
    const src = fs.readFileSync(file, 'utf8');
    const { out: afterImg, changed } = rewriteHtml(src, manifest);
    // Images also arrive through inline `background-image: url(...)` and
    // lightbox hrefs, which the <img> pass cannot see. Derivative URLs and
    // format-preserved assets resolve to themselves, so this is safe to run
    // over the whole document.
    const { out, changed: urlChanged } = rewriteUrls(afterImg, manifest);
    if (out !== src) {
      fs.writeFileSync(file, out);
      files++;
      imgs += changed + urlChanged;
    }
  }

  const extraTargets = [
    'public/sitemap-images.xml',
    'public/image-sitemap.xml',
    'public/schema/taramsv.jsonld',
    'public/schema/all-locations.jsonld',
    'public/manifest.json',
    'public/css/static-overrides.css',
    'index.html',
  ].map((p) => path.join(artifactDir, p));

  let urls = 0;
  for (const file of extraTargets) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const { out, changed } = rewriteUrls(src, manifest);
    if (out !== src) {
      fs.writeFileSync(file, out);
      files++;
      urls += changed;
    }
  }

  console.log(
    `[optimize-assets] Rewrote ${imgs} <img> tags and ${urls} feed/meta URLs across ${files} files`,
  );
}

// ─── main ─────────────────────────────────────────────────────────────────────

const manifest = await runEncodePhase();
runRewritePhase(manifest);
