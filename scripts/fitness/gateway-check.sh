#!/usr/bin/env bash
# FITNESS: all LLM calls go through the inference-gateway seam.
# Fails if a vendor LLM SDK is imported anywhere outside src/modules/inference-gateway/.
set -u
root="$(git rev-parse --show-toplevel)"
hits="$(grep -rEn "from ['\"](openai|@anthropic-ai/[a-z-]+|@google/generative-ai|cohere-ai)" \
  "$root/src" --include='*.ts' 2>/dev/null | grep -v "src/modules/inference-gateway/" || true)"
if [ -n "$hits" ]; then
  echo "FAIL gateway-check: LLM SDK imported outside inference-gateway:"; echo "$hits"; exit 1
fi
echo "ok gateway-check"
