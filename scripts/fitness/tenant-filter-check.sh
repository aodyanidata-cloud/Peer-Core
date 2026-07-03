#!/usr/bin/env bash
# FITNESS: tenant context is never taken from client input.
# Fails on assignment of a tenant id straight from a request object.
set -u
root="$(git rev-parse --show-toplevel)"
hits="$(grep -rEn "tenant_?[Ii]d\s*[:=]\s*(req|request|body|query|params|headers)\." \
  "$root/src" --include='*.ts' 2>/dev/null || true)"
if [ -n "$hits" ]; then
  echo "FAIL tenant-filter-check: tenant_id sourced from client input:"; echo "$hits"; exit 1
fi
echo "ok tenant-filter-check"
