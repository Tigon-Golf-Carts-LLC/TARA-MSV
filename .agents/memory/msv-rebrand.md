---
name: MSV rebrand rules
description: How the Aug 2026 rebrand to TARA Medium Speed Vehicles / taramsv.com was done and what must stay unchanged
---

The site was rebranded from TARA Neighborhood Electric Vehicles (taragolfcart.com, dealer domain taranev.com) to **TARA Medium Speed Vehicles (taramsv.com)**.

Rules:
- Only visible text, titles, alt/meta, JSON-LD, and public *.txt/*.xml docs were reworded ("golf cart"/"electric vehicle"/NEV → "medium speed vehicle"/MSV; domains → taramsv.com; email info@/sales@taramsv.com).
- **URLs, route paths, routes.json path/file keys, slugs, and image filenames keep original hyphenated `golf-cart` forms — never rewrite them**, or links/images break.
- `scripts/localize-assets.mjs` intentionally still references taragolfcart.com (it downloads from the original site) — leave it.
- The logo file keeps the `tara-nev-logo.png` filename but now contains the MSV badge art; favicon.png/.ico/.svg, apple-touch-icon.png, and og-image.png were regenerated from it.
- Compliance wording: FMVSS No. 500 is the federal *low-speed vehicle* standard — do not call it an MSV standard.

- **"golf cart" is intentionally retained in prose where it has a distinct meaning** (editorial pass, Aug 2026): traditional golf carts (as a contrast category), disc golf carts, walking golf carts, golf buggies/beach buggies, wheel/push golf carts, caddy carts, cart bag holder/rack, and "LSV(s)" (dropped the redundant "LSV medium speed vehicle"). Do NOT blanket-replace these back to MSV.

**Why:** a blind find/replace on hyphenated or filename forms breaks routing/assets, and blanket replacement of "golf cart" mangles golf-equipment terms (disc golf, push trolleys, cart bags) into nonsense; the space-form replacement is safe only for the vehicle-product sense.
**How to apply:** after any merge or content regeneration, re-grep for `taragolfcart|taranev|Neighborhood Electric` and re-apply text-only replacement; for `golf cart` matches, check context against the retained-terms list above before replacing.

## TARA Dealership SEO pass (Aug 2026)
- Site-wide keyword is "TARA Dealership": routes.json titles suffixed "| TARA Dealership", descriptions mention dealership, footer + JSON-LD alternateName carry it. structuredData.ts stripSiteSuffix regex must keep stripping "| TARA Dealership" or product names in JSON-LD get polluted.
- public/ holds a generated SEO/AI file suite (many sitemaps, rss/atom, product feeds, locations.*, schema/*.jsonld). Rule: no unverified merchant claims in feeds/schema — no stock status, store codes, hours, or price ranges; the US-center coordinate is labelled "not a storefront".
