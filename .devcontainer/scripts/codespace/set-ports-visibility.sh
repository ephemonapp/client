#!/usr/bin/env bash
# detect GitHub Codespaces
if [ "${CODESPACES:-}" = "true" ] && command -v gh >/dev/null 2>&1; then
  for port in 8081 5027; do
    gh codespace ports visibility "${port}:public" \
      -c "${CODESPACE_NAME}" \
      && echo "Port $port set to public" \
      || echo "Failed to set port $port"
  done
else
  echo "Not in Codespaces or gh CLI unavailable, skipping port visibility."
fi