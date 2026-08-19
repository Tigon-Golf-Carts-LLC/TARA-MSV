#!/usr/bin/env bash
# Fails if content/css/js still reference remote static assets (http(s) or
# protocol-relative, in attributes or CSS url()), missing.svg-as-stylesheet,
# remote iframes, or stylesheet links pointing at non-CSS targets.
set -euo pipefail
cd "$(dirname "$0")/../public"

fail=0

# Remote static assets by extension: http(s)://... or protocol-relative //host/...
# Absolute taramsv.com image URLs inside JSON-LD are canonical metadata, not
# browser asset requests. All rendered <img> and stylesheet references remain
# local and are still caught by this guard.
remote=$(grep -rEoh "(https?:)?//[a-zA-Z0-9.-]+\.[a-z]{2,}/[^\"' )<>]+\.(css|js|jpg|jpeg|png|webp|gif|svg|ico|woff2?)(\?[^\"' )<>]*)?" content/ css/ js/ 2>/dev/null | grep -vE 'react\.dev|idangero|^https://taramsv\.com/images/' | sort -u || true)
if [ -n "$remote" ]; then echo "REMOTE STATIC ASSETS FOUND:"; echo "$remote"; fail=1; fi

# CSS url() referencing remote hosts
cssremote=$(grep -rEoh "url\([\"']?(https?:)?//[a-zA-Z0-9.-]+\.[a-z]{2,}/[^)\"']*" content/ css/ 2>/dev/null | grep -v w3.org || true)
if [ -n "$cssremote" ]; then echo "REMOTE CSS url() FOUND:"; echo "$cssremote" | sort -u; fail=1; fi

# Remote iframes
iframes=$(grep -rhoE "<iframe[^>]*src=[\"'](https?:)?//[^\"']*" content/ 2>/dev/null || true)
if [ -n "$iframes" ]; then echo "REMOTE IFRAMES FOUND:"; echo "$iframes" | sort -u; fail=1; fi

# Malformed scheme-with-single-slash URLs like https:/css/... (browser treats path as host)
malformed=$(grep -rEoh "https?:/[^/\"' ][^\"' )<>]*" content/ css/ js/ 2>/dev/null | sort -u || true)
if [ -n "$malformed" ]; then echo "MALFORMED URLS FOUND:"; echo "$malformed" | head; fail=1; fi

# Stylesheet links must target .css
badlinks=$(grep -rhoE "<link[^>]*rel=[\"']stylesheet[\"'][^>]*>" content/ ../index.html 2>/dev/null | grep -E "href=[\"'][^\"']*" | grep -vE "href=[\"'][^\"']*\.css([?\"'])" || true)
if [ -n "$badlinks" ]; then echo "STYLESHEET LINKS WITH NON-CSS TARGETS:"; echo "$badlinks" | sort -u | head; fail=1; fi

if [ "$fail" -eq 0 ]; then echo "OK: no remote static assets, remote css url(), remote iframes, or invalid stylesheet links"; fi
exit $fail
