# Ephemon MLS

This is the project-owned Rust/WASM boundary around pinned OpenMLS. It owns conversation-scoped MLS credentials,
KeyPackages, group creation and joining, Commit/Welcome generation, encrypted application messages, authenticated sender
recovery and versioned checkpoint export/import. MLS primitives are not reimplemented in TypeScript.

The browser application loads the generated binding only inside `mls.worker.js`. Every state-mutating worker command
returns a new opaque checkpoint and remains pending until the encrypted vault accepts that checkpoint. A failed write
causes the worker to restore its previous checkpoint before another command may run.

Build the release artifact with `npm run mls:build` in an environment containing Rust with the `wasm32-unknown-unknown`
target and exactly `wasm-bindgen-cli 0.2.100`. Local project work runs this command through Docker.
`npm run mls:test:browser` then verifies the direct facade, isolated workers, rollback, encrypted checkpoint storage and
restart continuity in Chromium.
