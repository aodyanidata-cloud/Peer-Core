#!/usr/bin/env bash
# FITNESS: engine-core modules stay generic — no restaurant/vertical vocabulary.
# Fails if vertical terms leak into generic core modules.
set -u
root="$(git rev-parse --show-toplevel)"
core="identity tenancy catalog agent inference-gateway tool-dispatcher"
bad='menu|reservation|diner|restaurant|branch|waitlist|cuisine'
fail=0
for m in $core; do
  d="$root/src/modules/$m"
  [ -d "$d" ] || continue
  hits="$(grep -rEin "$bad" "$d" --include='*.ts' 2>/dev/null || true)"
  if [ -n "$hits" ]; then echo "FAIL no-vertical-leak: vertical term in core module '$m':"; echo "$hits"; fail=1; fi
done
[ "$fail" -eq 0 ] && echo "ok no-vertical-leak-check"
exit "$fail"
