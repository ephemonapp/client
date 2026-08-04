#!/usr/bin/env sh
set -eu

EXPECTED_WASM_BINDGEN_VERSION='0.2.100'
ACTUAL_WASM_BINDGEN_VERSION="$(wasm-bindgen --version | awk '{print $2}')"
if [ "$ACTUAL_WASM_BINDGEN_VERSION" != "$EXPECTED_WASM_BINDGEN_VERSION" ]; then
    echo "wasm-bindgen $EXPECTED_WASM_BINDGEN_VERSION is required, found $ACTUAL_WASM_BINDGEN_VERSION" >&2
    exit 1
fi

cargo build --locked --release --target wasm32-unknown-unknown -p ephemon-mls
wasm-bindgen \
    --target no-modules \
    --out-dir target/wasm-bindgen \
    target/wasm32-unknown-unknown/release/ephemon_mls.wasm
