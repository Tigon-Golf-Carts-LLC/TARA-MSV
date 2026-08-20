# TARA Medium Speed Vehicles

Full rebuild (clone) of the client's website, rebranded August 2026 from taragolfcart.com (TARA Neighborhood Electric Vehicles) to taramsv.com — TARA Medium Speed Vehicles. All 650 pages with original images; product wording site-wide changed from "golf cart"/"electric vehicle"/NEV to "medium speed vehicle"/MSV (text, titles, alt/meta only — URLs, slugs, and image filenames keep their original golf-cart forms).

## Run & Operate

This is a **100% static site**. There is no server, no API and no database: every
dynamic value is resolved at build time and baked into the output. `dist/` is
plain files that GitHub Pages serves directly.

- `pnpm --filter @workspace/tara-ev run dev` — local dev server
- `pnpm --filter @workspace/tara-ev run build` — snapshot + SEO + images + bundle + prerender + verify
- `pnpm --filter @workspace/tara-ev run build:site` — same, skipping the data-snapshot step
- `pnpm --filter @workspace/tara-ev run preview` — serve `dist/` locally
- `pnpm run typecheck` — full typecheck across all packages

Deployment is `.github/workflows/deploy.yml` (push to `main` or manual dispatch)
→ `actions/upload-pages-artifact` → `actions/deploy-pages`. `SITE_DOMAIN` and
`BASE_PATH` live in the workflow `env:` block; `BASE_PATH` is `/` for a custom
domain and `/<repo-name>/` for a project site.

## Stack

- pnpm workspaces, React + Vite (artifact `tara-ev`)
- The site is a static content mirror: extracted page HTML lives in `artifacts/tara-ev/public/content/*.html` (one file per page, slugs use `__` for `/`), routed by `public/content/routes.json` (path → file, title, bodyClass)
- `src/App.tsx` fetches the content file for `location.pathname`, injects it, then loads the site's original behavior script `public/js/jquery.min_index.js` (menus, sliders, tabs); the external Mautic inquiry-form script was removed at the client's request and replaced with a self-hosted form on the contact page (see "Client-requested removals")
- Original site CSS: `public/css/site.css` (rewritten from the live site's stylesheet, all assets localized), `public/css/menu-image.css`
- Image **sources** live in `artifacts/tara-ev/assets-src/images/` and are never deployed.
  `scripts/optimize-assets.mjs` (sharp + svgo) generates `public/images/` — WebP at
  400/800/1200/1600w, EXIF stripped, capped at 1600px — and rewrites every `<img>`
  with `srcset`/`sizes`/`width`/`height`/`loading`/`decoding`. `public/images/` is
  generated and gitignored; `assets-manifest.json` records the mapping.
- Fonts in `public/fonts/` are woff2-only with `font-display` set

## Where things live

- Page content: `artifacts/tara-ev/public/content/` — to edit page text, edit the corresponding HTML file
- Navigation between pages uses normal full-page loads (each `<a>` reload re-runs App), matching original site behavior

## Architecture decisions

- Content-mirror approach chosen over hand-built React components because the site has 650 pages (575 news articles) sharing WordPress templates; this preserves pixel-exact fidelity site-wide
- The original jQuery bundle is reused for interactive behavior instead of reimplementing sliders/menus
- Analytics/tracking scripts (GTM, LinkedIn) from the original pages were stripped

## Product

Marketing site for TARA electric golf carts and utility vehicles: home, vehicle series (T1/T2/T3) and ~25 product pages, accessories, support/warranty/safety pages, cases, about, contact, and a large news/blog section.

## User preferences

- This is a clone/migration of the client's own site — keep content identical to the original unless asked.

## Client-requested removals (do NOT restore)

The client asked for these to be deleted site-wide. A past merge accidentally restored them once — never bring them back when regenerating or restoring page content:

- Mautic inquiry form: any `mauticform` markup, the external form script from `formcs.globalso.com`, vendored `public/js/form-generate.js` / `public/js/mautic-form.js`, and `<section class="inquiry-form-wrap">`
- Floating contact sidebar: `<ul class="right_nav">` and inquiry popup `<div class="inquiry-pop-bd">`
- WhatsApp widget: `#whatsapp` / `#whatsappMain`
- Footer: `<footer class="web-footer">`

Guard script: `artifacts/tara-ev/scripts/verify-removals.sh` (registered as validation step `verify-removals`) fails if any of these reappear.

## Contact (no backend)

Static hosting cannot accept a form post, so there is no contact form. Every
call to action is a `mailto:` or `tel:` link:

- Email: `taradealership@gmail.com`
- Phone: `1-844-844-3432` (links are `tel:+18448443432`)

Both are injected site-wide by the footer in `src/App.tsx` and appear in the
contact page content. If a real form is ever needed, point it at a third-party
endpoint (Formspree / Netlify Forms / Google Forms) — never at a same-origin
`/api/` route, which `scripts/verify-dist.mjs` fails the build on.

The only `<form>` elements left are the theme's search boxes; `prerender.mjs`
rewrites their `action="/search.php"` to Google site search at build time.

## Gotchas

- Do not edit `public/content/*.html` image URLs back to cdn.globalso.com — all assets are localized
- `public/content/routes.json` is the build-time authoring source (with per-route
  descriptions). The client fetches the minified `content/site-snapshot.json`
  emitted by `scripts/fetch-data.mjs`; `routes.json` is dropped from `dist/`.
- Icons, `og-image` and the logo deliberately stay PNG (`KEEP_FORMAT` in
  `optimize-assets.mjs`) — MIME-typed `<link rel="icon">` and social scrapers
  need them. Everything else is WebP.
