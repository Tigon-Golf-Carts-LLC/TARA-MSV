---
name: TARA site clone architecture
description: How the taragolfcart.com clone is structured and how to edit it
---
The tara-ev artifact is a static content mirror, not a component-based React app.
**Why:** 650 pages (575 blog posts) share WordPress templates; per-page HTML + original CSS/jQuery gives pixel-exact fidelity.
**How to apply:** Edit page text in `artifacts/tara-ev/public/content/<slug>.html` (slug = URL path with `/`→`__`). Routes/titles in `content/routes.json`. Never point asset URLs back at cdn.globalso.com — everything is localized under `public/images|css|fonts|js`.

- Brand: site is "TARA Medium Speed Vehicles" at taramsv.com; the logo keeps the legacy public/images/tara-nev-logo.png filename — preserve current MSV text after merges.
