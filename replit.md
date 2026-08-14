# TARA Medium Speed Vehicles

Full rebuild (clone) of the client's website, rebranded August 2026 from taragolfcart.com (TARA Neighborhood Electric Vehicles) to taramsv.com — TARA Medium Speed Vehicles. All 650 pages with original images; product wording site-wide changed from "golf cart"/"electric vehicle"/NEV to "medium speed vehicle"/MSV (text, titles, alt/meta only — URLs, slugs, and image filenames keep their original golf-cart forms).

## Run & Operate

- Workflow `artifacts/tara-ev: web` — the website (served at `/`)
- `pnpm run typecheck` — full typecheck across all packages

## Stack

- pnpm workspaces, React + Vite (artifact `tara-ev`)
- The site is a static content mirror: extracted page HTML lives in `artifacts/tara-ev/public/content/*.html` (one file per page, slugs use `__` for `/`), routed by `public/content/routes.json` (path → file, title, bodyClass)
- `src/App.tsx` fetches the content file for `location.pathname`, injects it, then loads the site's original behavior script `public/js/jquery.min_index.js` (menus, sliders, tabs); the external Mautic inquiry-form script was removed at the client's request and replaced with a self-hosted form on the contact page (see "Client-requested removals")
- Original site CSS: `public/css/site.css` (rewritten from the live site's stylesheet, all assets localized), `public/css/menu-image.css`
- All 400+ images in `public/images/`, fonts (Poppins, FontAwesome) in `public/fonts/`

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

## Contact form (self-hosted replacement)

The contact page (`/contact/`) now uses a self-hosted inquiry form instead of the removed Mautic embed:

- Frontend: `artifacts/tara-ev/src/inquiryForm.ts` — renders the form and posts to the API server
- Backend: `artifacts/api-server/src/routes/inquiries.ts` — validates and delivers via Gmail
- Email delivery: `artifacts/api-server/src/lib/email.ts` — uses the Gmail Replit connector (`google-mail`)
- Recipient: `sales@taramsv.com`

## Gotchas

- Do not edit `public/content/*.html` image URLs back to cdn.globalso.com — all assets are localized
- The self-hosted inquiry form mounts into `#tara-inquiry-form` (injected by App.tsx after the article element on form pages) — this is separate from the removed `inquiry-form-wrap` section
