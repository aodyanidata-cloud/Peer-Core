#!/usr/bin/env bash
# FITNESS: no committed secrets.
# Scans tracked files for obvious credential patterns; .env.example is allowed (shape only).
set -u
root="$(git rev-parse --show-toplevel)"
cd "$root" || exit 1
files="$(git ls-files '*.ts' '*.js' '*.json' '*.mjs' '*.yml' '*.yaml' 2>/dev/null | grep -v '.env.example' || true)"
[ -z "$files" ] && { echo "ok secrets-scan (no files)"; exit 0; }
# shellcheck disable=SC2086
hits="$(grep -EnI "(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|password\s*[:=]\s*['\"][^'\"]{6,})" $files 2>/dev/null || true)"
if [ -n "$hits" ]; then
  echo "FAIL secrets-scan: possible secret committed:"; echo "$hits"; exit 1
fi
echo "ok secrets-scan"
