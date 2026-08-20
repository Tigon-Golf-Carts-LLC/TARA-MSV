---
name: Static-only build pipeline
description: How tara-ev builds for GitHub Pages, and the traps in the image/asset pipeline
---

The workspace is frontend-only. `artifacts/api-server` and all of `lib/` (Drizzle
db, api-spec, api-zod, api-client-react) were deleted — do not reintroduce a
server, an ORM, or an `/api/` route. `scripts/verify-dist.mjs` fails the build on
a same-origin `/api/` call, a `localhost` URL, or a known secret name in `dist/`.

**Image pipeline.** Sources: `artifacts/tara-ev/assets-src/images/` (committed,
never deployed). Output: `public/images/` — **generated and gitignored**, so a
fresh clone has no images until `pnpm run optimize-assets` runs (the `dev` and
`build` scripts run it for you). `assets-manifest.json` is committed and maps
every source URL *and* every derivative URL to its entry, which is what makes
the markup rewrite idempotent.

Traps that already bit once:
- A `.webp` **source** and its base derivative share a URL. The lookup must let
  the source mapping win, or every WebP original silently loses its `srcset`.
- Browser icons, `og-image` and `tara-nev-logo` must keep PNG (`KEEP_FORMAT`).
  Converting them 404s `<link rel="icon" type="image/png">` and the PWA manifest.
- Images also arrive via inline `style="background-image: url(...)"`, not just
  `<img src>`. The rewrite runs a URL pass over the whole document for that.
- `width`/`height` this script fills in are marked `data-intrinsic="1"`; without
  that marker the `sizes` heuristic mistakes them for author-declared widths and
  wrongly emits `sizes="100vw"`.

**Sizing.** A 2000px cap with a 400/800/1200/1600 ladder at q80 measured 526 MB
of `dist/` — past the 500 MB gate. Current settings (cap 1600, q76) land at
~308 MB. If you widen the ladder, re-measure.

**How to apply:** after changing encoder settings bump `PIPELINE_VERSION` in
`optimize-assets.mjs` so cached derivatives regenerate, then run the full build
and check `verify-dist` output.
