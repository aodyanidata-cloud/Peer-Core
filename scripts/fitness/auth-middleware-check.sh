#!/usr/bin/env bash
# FITNESS: authorization is centralized, not ad-hoc.
# Fails if a controller hand-rolls a raw password/jwt compare instead of the auth layer.
set -u
root="$(git rev-parse --show-toplevel)"
hits="$(grep -rEn "(bcrypt\.compare|jwt\.verify|jsonwebtoken)" \
  "$root/src/modules" --include='*.ts' 2>/dev/null | grep -v "src/modules/identity/" || true)"
if [ -n "$hits" ]; then
  echo "FAIL auth-middleware-check: auth primitive used outside identity module:"; echo "$hits"; exit 1
fi
echo "ok auth-middleware-check"
