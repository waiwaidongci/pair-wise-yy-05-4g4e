#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-build}"
shift || true

if [[ -n "${CODEX_FIXED_NODE:-}" && -x "${CODEX_FIXED_NODE}" ]]; then
  exec "${CODEX_FIXED_NODE}" node_modules/@angular/cli/bin/ng.js "${command_name}" "$@"
fi

if [[ "$(uname -s)" == "Darwin" && -x "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" ]]; then
  runtime_node="node_modules/.runtime/node"
  if [[ ! -x "${runtime_node}" || "${runtime_node}" -ot "scripts/node-entitlements.plist" ]]; then
    mkdir -p node_modules/.runtime
    cp "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" "${runtime_node}"
    codesign \
      --force \
      --sign - \
      --entitlements scripts/node-entitlements.plist \
      --options runtime \
      "${runtime_node}"
  fi
  exec "${runtime_node}" node_modules/@angular/cli/bin/ng.js "${command_name}" "$@"
fi

exec node node_modules/@angular/cli/bin/ng.js "${command_name}" "$@"
