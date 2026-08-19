#!/usr/bin/env bash
# Fails if rename-mangled wording from the golf-cart → MSV rebrand reappears.
# Past merges/regeneration have produced phrases like "an medium speed vehicle",
# "disc medium speed vehicle", or "LSV medium speed vehicle". See
# .agents/memory/msv-rebrand.md — retained golf-cart prose terms (disc golf
# carts, walking golf carts, buggies, cart bags, LSVs, "traditional golf
# carts") are intentional and must stay; the mangled MSV forms must not exist.
# Scans source content and, when present, the production build output
# (dist). Pass --require-dist to fail if dist is missing.
set -euo pipefail
cd "$(dirname "$0")/.."

require_dist=0
if [ "${1:-}" = "--require-dist" ]; then
  require_dist=1
fi

scan_dirs=(public/content/ src/ index.html public/js/)
if [ -d dist ]; then
  scan_dirs+=(dist/)
elif [ "$require_dist" -eq 1 ]; then
  echo "ERROR: dist not found — build output must exist for pre-publish verification"
  exit 1
fi

fail=0

check() {
  local label="$1" pattern="$2"
  local hits
  hits=$(grep -rilE "$pattern" "${scan_dirs[@]}" 2>/dev/null | sort -u || true)
  if [ -n "$hits" ]; then
    echo "MANGLED WORDING FOUND — $label:"
    echo "$hits" | head -20
    fail=1
  fi
}

check "wrong article ('an medium speed')" \
  '\ban medium speed'
check "tautology ('medium speed vehicle is a medium speed vehicle')" \
  'medium speed vehicle is an? medium speed vehicle'
check "disc golf mangled ('disc medium speed')" \
  'disc medium speed'
check "walking golf cart mangled ('walking medium speed')" \
  'walking medium speed'
check "golf buggy mangled ('buggy medium speed')" \
  'buggy medium speed'
check "redundant LSV ('LSV medium speed')" \
  'LSVs? medium speed'
check "contrast category mangled ('traditional medium speed')" \
  'traditional medium speed'
check "cart bag mangled ('medium speed vehicle bag')" \
  'medium speed vehicle bag'

if [ "$fail" -eq 0 ]; then
  echo "OK: no rename-mangled wording found"
fi
exit $fail
