#!/usr/bin/env bash
# Run every fitness function; fail if any fails.
set -u
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rc=0
for f in gateway-check no-vertical-leak-check tenant-filter-check auth-middleware-check secrets-scan; do
  bash "$dir/$f.sh" || rc=1
done
[ "$rc" -eq 0 ] && echo "== fitness: all checks passed ==" || echo "== fitness: FAILURES above =="
exit "$rc"
