---
name: MSV rebrand rules
description: How the Aug 2026 rebrand to TARA Medium Speed Vehicles / taramsv.com was done and what must stay unchanged
---

The site was rebranded from TARA Neighborhood Electric Vehicles (taragolfcart.com, dealer domain taranev.com) to **TARA Medium Speed Vehicles (taramsv.com)**.

Rules:
- Only visible text, titles, alt/meta, JSON-LD, and public *.txt/*.xml docs were reworded ("golf cart"/"electric vehicle"/NEV → "medium speed vehicle"/MSV; domains → taramsv.com; email info@/sales@taramsv.com).
- **URLs, route paths, routes.json path/file keys, slugs, and image filenames keep original hyphenated `golf-cart` forms — never rewrite them**, or links/images break.
- `scripts/localize-assets.mjs` intentionally still references taragolfcart.com (it downloads from the original site) — leave it.
- The logo file is still `tara-nev-logo.png` (filename kept); user to supply a new MSV logo.
- Compliance wording: FMVSS No. 500 is the federal *low-speed vehicle* standard — do not call it an MSV standard.

**Why:** a blind find/replace on hyphenated or filename forms breaks routing/assets; the space-form replacement is safe.
**How to apply:** after any merge or content regeneration, re-grep for `taragolfcart|taranev|Neighborhood Electric|golf cart` in content/src and re-apply text-only replacement.
