---
name: Client-requested removals on tara-ev
description: Elements the client deleted that task-agent merges keep restoring — check after every merge.
---

The client explicitly deleted these from the tara-ev site; do NOT restore them, and re-check after every task-agent merge (a merge has already restored them once):

- Mautic inquiry form (`form#mauticform_daierle`) and its generator script — no `formcs.globalso.com` script, no vendored `public/js/form-generate.js` / `mautic-form.js`, no form-script loading in `src/App.tsx`, no `section.inquiry-form-wrap` in content pages.
- Floating right-edge contact sidebar `ul.right_nav` + `div.inquiry-pop-bd` popup.
- Floating WhatsApp widget `div#whatsapp.footer-whatsapp` / `#whatsappMain`.
- Site footer `<footer class="web-footer">`.
- Custom 404 view in App.tsx (unknown URLs redirect to home instead).
- Cookie consent banner (`#cmplz-cookiebanner-container`) — its generator was section 4 of `public/js/jquery.min_index.js`, now cut from the bundle; `site.css` hides the container as a safeguard.
- Hero "watermark" background-text spans (`span.tit-bg`) on home.html.

**Why:** the offline-localization task agent vendored external assets wholesale and re-added the form scripts and widget markup on ~630 pages; had to strip them again.
**How to apply:** guard script `artifacts/tara-ev/scripts/verify-removals.sh` (validation step `verify-removals`) now fails when these reappear — run it after merges. It also scans `dist/public` when present, and the production build (`pnpm build`) runs it with `--require-dist`, so publishing is blocked if removed content reappears in build output. Dead `.mauticform*` CSS selectors in `site.css` are harmless and intentionally excluded from the mauticform text check (CSS files only). Manually, grep for `mauticform|form-generate|right_nav|inquiry-pop-bd|footer-whatsapp|web-footer">` before declaring done. `site.css` has `display:none` safeguards for these selectors — keep them.

Also: Press section was replaced by `/blog/` (12 original posts, files `content/blog*.html`); all `/news/`* routes were deleted — don't reintroduce them.
- Language switcher (div.change-language / "English" dropdown) deleted from all pages Aug 2026; CSS display:none guard in site.css. Re-grep "change-language" after merges.
- Header "English" flag button (div.language-flag) deleted from all pages; CSS guard added.
- WARNING: language flags are <li class="language-flag"> inside <ul id="prisna-translator-seo">, NOT divs — balanced-div removal scripts corrupted 648 files once. Match the actual tag.
- Header search button (<b id="btn-search">) deleted from all pages; CSS guard added.
- Call Now button (tel:+18448443432) is INTENTIONAL: injected site-wide by App.tsx (#tara-call-now) + styled in site.css. Do not remove when sweeping floating widgets. Dealership phone: 1-844-844-3432.

- The "Online Service" floating tab is `<aside class="scrollsidebar">` — it survived in 577 pages unnoticed because the verify script didn't cover it (now it does). When something looks like a removed widget in a screenshot but greps clean, search for `side`/`aside` class fragments, not the visible label — the label may be image- or CSS-rendered.
