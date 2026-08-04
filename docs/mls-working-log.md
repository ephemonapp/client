# MLS implementation working log

This is the live execution log for [`mls-everywhere-plan.md`](./mls-everywhere-plan.md). Architectural and product
decisions belong in [`mls-decisions.md`](./mls-decisions.md); this file records implementation progress, verification
and the immediate next steps.

## Working rules

1. Keep this file current while the MLS work is in progress: record material changes, checks, blockers and next steps.
2. Escalate a product or protocol choice to the project owner when it cannot be derived safely from an accepted
   decision.
3. Record every answer to an escalated choice in `mls-decisions.md` before implementing behavior that depends on it.
4. Do not treat ordinary technical findings as product decisions. Record them here with evidence and continue when they
   do not change accepted behavior or protocol semantics.
5. Work on branch `codex/mls-everywhere` and do not create commits unless the project owner explicitly approves a
   commit.
6. Run builds, tests, package installation and toolchains only through Docker. The host is used only to edit the working
   tree and orchestrate containers.
7. Keep the signaling server contracts and the two connection sagas unchanged unless a later accepted decision says
   otherwise.

## Current status

Branch: `codex/mls-everywhere`  
Current increment: Increment 6 MLS application events  
Commits created by Codex: none  
Open product decisions: none

## 2026-08-04 — Increment 0

### Completed

- Reviewed the accepted MLS architecture decisions and confirmed that no unresolved product choice blocks Increment 0.
- Created and switched to the separate `codex/mls-everywhere` branch.
- Ran the pre-change Vitest baseline: 39 files and 416 tests passed.
- Added a deterministic adversarial transport harness supporting capture, delayed delivery, explicit reordering,
  duplication, dropping, disconnect and reconnect.
- Added tests for offline replica convergence, binary data-channel payload fidelity and the current `ConnectionSaga`
  under duplicate, reordered and lost packets.
- Confirmed the existing `Connection` regression suite locks first-connected incoming/outgoing saga selection and
  failover to the surviving connected saga.
- Added reusable persistence crash points and tests for crashes before and after each transaction boundary.
- Added a versioned fixture that locks the existing signaling JSON contracts, including the close beacon payload.
- Added the initial Rust workspace and `ephemon-mls` crate with an ABI-version smoke export.
- Added a path-filtered Rust/WASM CI workflow and a real-browser WASM smoke-test script.
- Cleaned Docker images, stopped containers, networks and build cache with `docker system prune -af` at the project
  owner's request. The command did not include `--volumes`; the first post-prune check still reported 58 unused volumes.
- Verified the Rust crate's native unit test and `wasm32-unknown-unknown` build in `rust:1-slim-bookworm`.
- Verified Rust formatting in Docker after installing the image's optional `rustfmt` component.
- Loaded the generated WASM module in real headless Chromium from `mcr.microsoft.com/playwright:v1.62.0-noble` and
  verified its ABI export is `1` for both debug and release artifacts.
- Ran a clean Node 24 Docker install and the full test suite: 43 test files and 433 tests passed.
- Kept test-only helper modules outside `__tests__` after the clean run demonstrated that this project's Vitest
  discovery treats every TypeScript file below `__tests__` as a test suite.
- Verified Rust formatting, Prettier formatting, whitespace and the new `mls-wasm.yml` workflow syntax using Docker-only
  checks.

### Next

1. Start Increment 1 by mapping every string-based `Connection`/`ConnectionSaga` call site and specifying the temporary
   UTF-8 compatibility adapter.
2. Convert the established data-channel path to exact binary payloads without changing signaling DTOs or saga state
   transitions.
3. Add zero-byte, non-UTF-8, buffer ownership and incoming/outgoing/failover regression tests before updating the
   application adapter.

## Known technical findings

- The current `packages/ephemon-core/tsconfig.spec.json` inherits a `rootDir` that makes direct standalone `tsc` test
  compilation fail before checking tests. Temporarily removing that mismatch exposed numerous pre-existing test typing
  errors. No TypeScript configuration was changed as part of Increment 0; Vitest is the established baseline check.
- The current Node dependency set warns under Node `24.12` because its `jsdom` dependency requests a slightly newer Node
  24 minor. The baseline tests still pass; the final clean run used the current `node:24-bookworm-slim` image.
- Clean `npm ci` reports two existing high-severity audit findings. They are not automatically modified because an audit
  fix may change the dependency graph and is outside the MLS Increment 0 behavior.
- The first clean post-change test run executed all 433 actual tests successfully but failed because two helper modules
  lived under `__tests__` and contained no test suites. Moving those helpers to `test-support` made the next full clean
  run pass without changing their behavior.
- A repository-wide `actionlint` run finds pre-existing shellcheck findings in `pr-checks.yml` and `release-oss.yml`.
  The new `mls-wasm.yml` passes when checked independently; unrelated workflows were not changed.
- The project owner removed the unused Docker volumes separately. The final Docker check reports zero local volumes. The
  four downloaded Node/Rust/Playwright/actionlint images occupy about 3.9 GB and are retained as the Docker-only
  toolchain for the next increments.
- Removed the 24 MB of host temporary Rust installer/build output created during setup; no host toolchain was installed.

## 2026-08-04 — Increment 1

### Completed

- Mapped the established data path. Text handling is confined to `ConnectionSaga`, the `Connection` public/internal
  types and the application bridge in `useEphemon`; signaling SDP/ICE serialization uses the same `Utf8` dependency but
  is a separate path and remains unchanged.
- Selected the application bridge as the temporary legacy compatibility boundary: `Connection` and `ConnectionSaga`
  expose only `Uint8Array`, while `useEphemon` explicitly encodes outgoing legacy JSON and decodes incoming legacy JSON.
- The binary receive boundary will accept `ArrayBuffer` and typed-array views, copy the exact view range, and reject
  text/Blob payloads. `RTCDataChannel.binaryType` will be pinned to `arraybuffer`.
- The binary send boundary will preserve empty data, zero bytes and non-UTF-8 bytes exactly before outer Secretbox
  encryption. Transport-level trimming, gzip and ungzip are removed only from the established data path.
- Converted public and internal `Connection`/`ConnectionSaga` send and receive callbacks from `string` to `Uint8Array`.
- Set every established RTC data channel to `binaryType = 'arraybuffer'`; inbound `ArrayBuffer` and typed-array views
  are copied using their exact offset/length before decryption and upper-layer dispatch.
- Removed trimming, gzip, ungzip and UTF-8 conversion from the established data path while leaving signaling SDP/ICE
  serialization unchanged and retaining per-saga Secretbox encryption.
- Added the explicit `legacyTextConnection` adapter in the application bridge, so the current JSON chat protocol still
  sees strings without reintroducing text semantics below `Connection`.
- Updated first-connected/failover tests to use byte arrays and added regression coverage for zero-length messages,
  embedded zero bytes, `0xff`, non-UTF-8 sequences, offset views, input/output buffer ownership, duplicated delivery,
  reordering and loss.
- Ran the focused connection suite in Docker: 15 files and 154 tests passed.
- Built both `@ephemon/core` and `@ephemon/app` in a clean Node 24 Docker container.
- Ran the complete clean test suite in Docker: 43 files and 435 tests passed.

### Next

1. Pin the audited OpenMLS release and its Rust dependency graph.
2. Replace the ABI-only WASM scaffold with the smallest project-owned OpenMLS facade for a real two-member flow.
3. Prove group creation, KeyPackage, add Commit/Welcome, join and application-message processing in a browser.
4. Prove exported state can be imported after a worker/browser-context restart and the group can continue.

### Technical notes

- The `pako` package remains in the dependency manifest for now, but the established connection data path no longer
  imports it. Dependency removal stays with the final legacy-protocol cleanup so unrelated package changes are not mixed
  into this increment.
- The temporary text adapter uses fatal UTF-8 decoding. Malformed non-UTF-8 bytes are valid at the binary `Connection`
  layer but are rejected if they are incorrectly routed into the legacy JSON consumer.

## 2026-08-04 — sequencing correction

- The project owner challenged the amount of transport work before a real OpenMLS integration. The criticism was
  correct: Increment 1 already supplied the only immediately required transport change, exact binary payloads.
- Removed the unfinished link framing, fragmentation, duplicate suppression and backpressure queue work. Only the
  completed and tested binary transport remains.
- No MLS primitive is or will be implemented in TypeScript. KeyPackage, Welcome, Proposal, Commit, epochs, TreeKEM,
  ratchets, MLS encryption/decryption and authenticated-sender processing belong to OpenMLS behind the Rust/WASM facade.
  TypeScript will only orchestrate the facade and application state.
- Reordered the implementation plan so a real two-member OpenMLS browser flow precedes further transport optimization.
  Actual serialized MLS artifact sizes will later drive framing and queue limits.

### Next

1. Verify which audited OpenMLS version can be pinned and record the exact audit/version boundary.
2. Implement the minimal Rust facade: credential/KeyPackage, create group, add member and emit Commit/Welcome, join,
   encrypt an application message and process it.
3. Export/import the required state and prove restart continuity.
4. Run the flow in real Chromium through Docker and record actual artifact sizes.

### OpenMLS audit and version finding

- The current public SRLabs audit, sponsored by the Sovereign Tech Agency, reports eight findings. OpenMLS states that
  seven fixes shipped in the `0.8.1` and `0.7.3` lines; one Low-severity finding was still being addressed when the
  audit announcement was published on 2026-05-27.
- Pin `openmls = 0.8.1` for the vertical slice, together with its matching `openmls_rust_crypto = 0.5.1`,
  `openmls_basic_credential = 0.5.0` and `openmls_traits = 0.5.0` crates. Enable OpenMLS's `js` feature for browser
  randomness and time support.
- This pin is acceptable for integration work but is not yet a production security sign-off. Before the hardening gate,
  re-check the remaining Low finding, every transitive security advisory and whether a newer audited patch release is
  available.
- OpenMLS `0.8.1`'s `js` feature enables the browser backend for its current `getrandom` dependency, but
  `openmls_rust_crypto` and `openmls_basic_credential` still reach `getrandom 0.2` through `rand 0.8`. The facade
  enables that older dependency's `js` feature only for `wasm32`; without it, the documented RustCrypto provider does
  not build for `wasm32-unknown-unknown`.

## 2026-08-04 — Increment 2

### Completed

- Pinned `openmls 0.8.1` and the matching RustCrypto, BasicCredential, traits, TLS codec and wasm-bindgen dependency
  versions in `Cargo.lock`.
- Replaced the ABI-only Rust scaffold with a project-owned facade. MLS credentials, KeyPackages, group creation,
  Commit/Welcome generation, joins, application encryption/decryption, sender authentication and epoch state are all
  implemented by OpenMLS in Rust; no MLS primitive was added to TypeScript.
- Made one facade client represent one conversation-scoped MLS identity. The BasicCredential identity is exactly the
  four-byte `MemberNumber`; the signing key is fresh for that client/group and is not the Ephemon account public key.
- Configured OpenMLS to emit encrypted `PrivateMessage` wire format for both application and member Commit messages.
  Native tests also assert that an application message contains neither plaintext nor the sender's signing public key.
- Kept Commit authorization and acceptance outside the cryptographic facade: `stage_add_member` creates a pending Commit
  and Welcome, while `merge_pending_commit` is a separate call for the future versioned policy layer.
- Added a bounded, versioned checkpoint format over OpenMLS's in-memory provider state. Import rejects truncation,
  trailing bytes, duplicate storage keys and configured resource-limit violations, reloads `MlsGroup`, restores the
  group-scoped signer and continues the existing sender ratchets.
- Added generated wasm-bindgen classes for the facade, add result and authenticated application result. The application
  sees sender `MemberNumber` plus plaintext only after OpenMLS processing; it does not supply or trust an author field.
- Added four native Rust tests covering the ABI, a complete two-member group, bidirectional authenticated messages,
  restart continuity for both clients and malformed checkpoint rejection.
- Upgraded the browser smoke test from loading one raw ABI export to performing the complete two-member flow in real
  Chromium, exporting both checkpoints, destroying both clients, importing them and exchanging a post-restart message.
- Updated the CI workflow to install the exactly matching wasm-bindgen CLI, generate browser bindings and run the full
  Chromium flow.
- Verified the locked native Rust suite: 4 tests passed. Verified the release `wasm32-unknown-unknown` build and the
  generated bindings in Chromium through Docker.
- Re-ran the complete TypeScript regression suite after removing the unfinished transport work and adding the Rust/WASM
  vertical slice: 43 test files and 435 tests passed.

### Measured two-member artifacts

- KeyPackage: 282 bytes
- add Commit: 697 bytes
- Welcome: 801 bytes
- encrypted application message for a 35-byte plaintext: 190 bytes
- creator checkpoint after one received message: 8,977 bytes
- invitee checkpoint after one received message: 8,746 bytes

These measurements do not justify adding fragmentation or backpressure to the direct-chat migration path. That work is
deferred until actual multi-member group artifacts and target browser SCTP limits are measured.

### Technical notes

- Checkpoints contain MLS secret state and signing material. The low-level facade intentionally exposes opaque bytes so
  restart behavior can be proven, but application code must not put them in UI state, logs or unencrypted IndexedDB. The
  worker/storage increment must wrap them in the existing-at-rest security model and make checkpoint replacement atomic
  before the facade is used by real chats.
- The generated release WASM is currently about 2.2 MiB before a size-optimization pass. Bundle-size work belongs to the
  worker integration/hardening increment, after the required API is stable.

### Next

1. Add `ConversationId`, `MemberNumber` and conversation state independently of the peer transport connection.
2. Add a typed worker client/build pipeline around the generated WASM API; TypeScript remains orchestration only.
3. Map the current IndexedDB and account-key lifecycle to an encrypted, atomic MLS checkpoint store and escalate only if
   that mapping exposes a product choice.
4. Bootstrap one existing direct conversation as a two-member MLS group over the unchanged binary `Connection`.

## 2026-08-04 — Increment 3 completed

### Completed

- Added branded, runtime-validated `ConversationId` and unsigned 32-bit `MemberNumber` types in core, plus discriminated
  legacy/MLS conversation models. Legacy conversations intentionally do not receive invented member numbers before MLS
  bootstrap establishes their canonical roles.
- Confirmed that persisted message history was already keyed by the numeric local conversation row ID. No destructive
  history migration is needed; the existing encrypted `connections` object store name remains as a compatibility detail
  while its records now explicitly carry `kind: direct` and `protocol: legacy` metadata.
- Re-keyed connection status, progress, unread counts, ordering and in-memory chat stores from the peer public key to
  `ConversationId`. The peer public key remains only the locator for Ephemon transport creation.
- Propagated `ConversationId` through the messenger, sidebar, chat pane and connection callback cache. The application
  build succeeds with these boundaries in Docker.
- Preserved handler registrations independently of a concrete `Connection`, so a conversation can attach them to a
  replacement transport instance without changing its local identity or history.
- Initially misread `closeByPeer` as an incidental connection loss and changed it to detach-only behavior. The project
  owner clarified that it is the explicit reciprocal-delete signal for personal chats. The change was reverted and the
  clarified semantics were recorded as D-008: ordinary transport loss preserves the conversation, explicit peer delete
  cascades for direct chats, and future group deletion is conversation-policy/admin controlled.
- Rebuilt `@ephemon/app` successfully after restoring direct-chat reciprocal deletion. Ran the complete clean TypeScript
  regression suite in a Linux-only Docker dependency volume: 44 test files and 449 tests passed, including the 14 new
  identifier boundary cases. The existing close-call tests still prove that an authenticated close call reaches
  `Connection.closeByPeer`; the application-level policy path is verified by the end-to-end scenario recorded below.
- Generalized the application message shape so MLS-authenticated messages and replies carry only group-local
  `MemberNumber` values. The existing `you|peer` labels now exist at an explicitly direct-chat-only view adapter, which
  rejects member numbers outside the two-person roster. Delivery, seen and reaction UI state is deliberately not copied
  into the authenticated message DTO; those become separately attributed events in Increment 6 under D-004.
- An unreviewed maximum checkpoint size was briefly added to the IndexedDB checkpoint write path while work had moved
  ahead into Increment 4. That database policy was not required by the accepted plan and was removed. Worker/storage
  changes already present in the working tree were parked until Increment 3 closed; no further out-of-sequence work was
  added.
- Re-ran the complete core suite after the message-model change: 44 files and 449 tests passed. Rebuilt `@ephemon/app`;
  Webpack and TypeScript compilation passed.
- Ran the existing reciprocal-delete Playwright scenario. It could not reach its deletion step because neither browser
  established the prerequisite SignalR connection. The captured trace shows successful `negotiate` responses followed by
  repeated `404` responses for the negotiated WebSocket, Server-Sent Events and long-poll connection IDs. The project
  owner clarified that `s.ephemon.app` is load-balanced by Traefik and relies on a sticky cookie for those follow-up
  requests. The test used the cross-site origin `audit.ephemon.test`, so the browser did not return that cookie. This
  was a test-origin defect, not a signaling-server outage. The test origin is changed to the same-site
  `audit.ephemon.app`; no client behavior or signaling contract is changed.
- Re-ran the unchanged reciprocal-delete scenario with the same-site test origin: it passed in real Chromium, and
  deleting Alice's direct chat removed it for both Alice and Bob. Increment 3 exit criteria are now satisfied.

### Next

1. Review the parked worker and checkpoint-storage changes strictly against the written Increment 4 deliverables and
   remove or defer anything outside them.
2. Verify the worker isolation, encrypted atomic checkpoint transaction and rollback behavior using the existing Docker
   browser tests.
3. Do not add database policy limits or proceed to direct-chat MLS bootstrap until Increment 4 itself is reviewed and
   green.

## 2026-08-04 — Increment 4 completed

### Completed

- Added `/target/` to the repository root `.gitignore`, removing only Cargo and wasm-bindgen build output from Git
  status. `Cargo.lock`, the Rust crate, source bindings, migrations, build scripts and browser tests remain reviewable
  source artifacts.
- Reviewed the existing typed worker client, worker state machine, encrypted checkpoint store and browser harness
  against the written Increment 4 deliverables. No new database size policy or signaling behavior was introduced.
- Made worker failure terminal at the TypeScript client boundary. After a worker crash, protocol mismatch, message
  decode failure or explicit `close()`, subsequent operations now reject immediately instead of posting to a dead worker
  and leaving an unresolved Promise.
- Made reload transactional inside the worker: a malformed checkpoint no longer frees the active OpenMLS client before
  the replacement is validated. Rollback likewise constructs the restored client before freeing the mutated one.
- Allowed an explicitly persisted checkpoint to replace a pending in-worker operation. This recovers the state where the
  IndexedDB transaction committed but the worker acknowledgement was lost; a pending operation without an authoritative
  checkpoint is still rejected.
- Marked a client session unusable when rollback itself fails and made a successful `initialize` restore it from the
  committed checkpoint. Temporary checkpoint copies are zeroed after load/save and pending rollback snapshots are zeroed
  after accept or replacement.
- Extended the Chromium harness to prove authoritative reload of pending state, preservation of the current session
  after a malformed reload, rollback after a failed checkpoint save and immediate rejection after client close.

### Verification

- `@ephemon/app` production graph and TypeScript worker bindings built successfully in Docker.
- Complete core suite: 44 test files and 449 tests passed.
- Native pinned OpenMLS facade: 4 tests passed.
- Real Chromium: two isolated typed workers created a two-member group, exchanged authenticated messages, restarted from
  encrypted checkpoints and continued at epoch 1 with roster `[0, 1]`.
- Real Chromium: encrypted IndexedDB checkpoint round-trip/CAS, failed-write rollback, pending-state authoritative
  reload and malformed-reload preservation all passed.
- Prettier and Rust formatting checks passed in Docker; `git diff --check` remains required after the next documentation
  update.

### Next

1. Define the smallest versioned, identity-free link-control envelope needed for MLS capability negotiation and
   bootstrap over the existing binary `Connection`.
2. Persist an explicit per-conversation bootstrap phase and encrypted two-member roster; do not overload transport saga
   state with MLS progress.
3. Implement deterministic creator/member-number assignment and the resumable KeyPackage → Commit/Welcome → ack flow.
4. Prove simultaneous open and crash/reconnect transitions without changing signaling DTOs or saga state machines.

## 2026-08-04 — Increment 5 completed

### Completed

- Added a versioned binary direct-bootstrap envelope with an unambiguous magic prefix and canonical encodings for
  capability `hello`, random group/routing initialization, KeyPackage, staged Commit/Welcome, joined epoch and final
  completion acknowledgement. Legacy JSON bytes remain distinguishable during the transition.
- Kept transport identities out of every bootstrap header and control field. Both endpoints derive the creator role and
  member numbers deterministically from the already authenticated Ephemon transport identities: the creator is member
  `0`, and the invitee is member `1`. The identities themselves are never serialized into a bootstrap frame.
- Extended atomic MLS checkpoint persistence with an encrypted companion value. Each OpenMLS mutation and the exact
  outbound bootstrap frame it produces are committed by one IndexedDB compare-and-swap transaction, so a crash cannot
  leave durable MLS state without a resumable link-level phase.
- Made the worker return the actual OpenMLS epoch produced by Welcome processing and pending-commit merge. Joined and
  complete acknowledgements are therefore built from the resulting cryptographic state, not from an assumed epoch.
- Implemented `DirectMlsBootstrapSession`, a serialized and idempotent state machine for the complete two-member flow:
  `hello → initialize → KeyPackage → Commit/Welcome → joined → complete`. Duplicate prior-step frames replay the
  persisted response instead of consuming another KeyPackage or applying Welcome twice.
- Added recovery for a lost final acknowledgement and simultaneous restart of both MLS workers. Each side reloads only
  its own encrypted checkpoint, exchanges hello, replays its last durable response and converges without importing the
  peer's serialized MLS state.
- Wired the state machine into the real application `Connection` callback boundary. Every open/degraded direct
  connection now loads the WASM worker and carries MLS bootstrap bytes over the existing binary, Secretbox-wrapped
  transport; non-bootstrap bytes continue through the temporary legacy text adapter until Increment 6 switches chat
  operations. Signaling DTOs and both connection sagas were not changed by this increment.
- Persisted the completed direct-chat roster binding in the existing encrypted conversation record: random routing ID,
  epoch, owner, local member number and peer member number. The peer public key remains the transport locator already
  stored in that encrypted record; it is not copied into MLS wire data.
- Added `/target/` to `.gitignore`; generated Cargo/wasm-bindgen output and existing Node/build output no longer pollute
  Git status, while Rust sources, `Cargo.lock`, migrations, scripts and tests remain reviewable.

### Verification

- Docker `@ephemon/app` build and TypeScript compilation passed with the production Messenger graph, MLS worker and WASM
  assets included.
- Complete Docker core suite: 44 test files and 449 tests passed.
- Real Chromium completed the typed bootstrap flow with epoch `1` and roster `[0, 1]`, then authenticated an application
  message from the creator as `MemberNumber = 0` after both workers were restarted at the dropped-ack boundary.
- Chromium checkpoint revisions for the bootstrap recovery scenario ended at creator `4` and invitee `3`; encrypted
  checkpoint/companion round-trip and CAS tests passed.
- Captured bootstrap frames were checked for both authenticated Ephemon transport public-key strings; neither occurred
  in the wire bytes.
- Prettier and `git diff --check` passed. No commit was created.

### Next

1. Add the versioned, identity-free MLS application-event envelope and durable per-member event identity model.
2. Route text, delivery, seen, reaction and typing through `createApplicationMessage` / `processApplicationMessage`,
   deriving the author only from OpenMLS processing.
3. Disable legacy plaintext history replay at the MLS boundary. Preserve local legacy records until the D-004 keyed
   intersection migration is implemented; never relabel unconfirmed legacy records as MLS-authenticated history.
4. Retain original MLS ciphertexts and make duplicate delivery over either saga idempotent before enabling anti-entropy.

## 2026-08-04 — Increment 6 in progress: live MLS chat path

### Completed in this cut

- Added an `application` kind to the identity-free binary direct wire envelope. It carries only the conversation's
  random routing ID and the serialized MLS `PrivateMessage`; it has no sender, recipient or transport public-key field.
- Added a versioned application payload envelope inside MLS. The first compatibility kind contains the existing chat
  update JSON but deliberately has no author field. The receiver accepts the update only after OpenMLS authenticates it
  and returns the expected peer `MemberNumber`.
- Changed the application callback boundary to await MLS readiness. Sends that race the initial bootstrap wait for the
  persisted `complete` state, then call `createApplicationMessage`; receives call `processApplicationMessage` before the
  chat reducer sees any payload.
- Routed all currently emitted direct-chat operations through that path: typing, text, delivered, seen and reaction.
  Duplicate MLS delivery is rejected by OpenMLS before a second UI update; the failed processing operation rolls back
  without advancing the checkpoint revision.
- Removed plaintext history replay from the connection-open callback and stopped accepting a nested `history` update.
  Existing legacy history remains encrypted and local; it is not relabelled as MLS-authenticated data before the D-004
  intersection protocol exists.
- Removed the live non-MLS fallback at the direct connection callback. A direct peer can no longer inject a plaintext
  JSON chat update after (or while racing) MLS bootstrap; bytes that are neither a versioned MLS control frame nor a
  versioned MLS application frame are rejected.
- Persisted `protocol: mls` in the encrypted conversation record after bootstrap completes. A restored conversation
  still waits for the local OpenMLS checkpoint to load and the link-level completion exchange before sending new
  operations.

### Verification

- Docker app build and TypeScript compilation passed.
- The real Chromium worker test now round-trips the application wire envelope and inner versioned payload, authenticates
  the creator as member `0`, and verifies that replaying the same MLS message is rejected.
- The existing two-browser, real-signaling Playwright scenario was expanded and passed twice. Both isolated pages loaded
  `/mls.wasm`; Alice sent a text that Bob rendered, Bob sent a reaction that Alice rendered, and the original reciprocal
  direct-chat deletion still removed the chat on both sides. This exercises the real Ephemon `Connection`,
  SignalR/Traefik sticky-cookie path, WASM workers and IndexedDB checkpoints rather than a mocked link.

### Still required before Increment 6 is complete

1. Replace timestamp message IDs and the compatibility JSON body with the canonical per-member sequence/hash event
   codec; replies must target event hashes.
2. Persist exact original MLS ciphertext/event records and idempotency indexes atomically enough to recover a send after
   a crash or link loss.
3. Attribute delivery, seen and reaction state as independent authenticated member events in durable history rather than
   retaining only the current direct-chat UI projection.
4. Add the anti-entropy frontier exchange, then implement the approved keyed legacy-history intersection migration.

## 2026-08-04 — Live MLS amplification incident

### Report

- With two local browsers, the connection UI reached connected but typing and text were delayed for a long time. Traffic
  later arrived in a burst; eventually both pages became unusable while the console repeated
  `[connection-saga] Error sending data ...` many thousands of times.
- The project owner suspected that the MLS code had been placed in a Service Worker that was not alive with the page.
  Inspection confirmed that `/mls.worker.js` is a dedicated `Worker`, constructed by `MlsWorkerClient` and owned by the
  live page. The unrelated application Service Worker is not in the MLS operation path.

### Root causes

1. `handleConnectionMessage` called the bootstrap `start()` method before every received MLS control frame. A repeated
   `start()` emitted another `hello`, so two peers reflected hello frames indefinitely. Once the browser was saturated
   and a data channel closed, the pre-existing saga send path logged one error for every remaining amplified frame.
2. The composer emitted `typing` on every input change. Each event waited for bootstrap, created an MLS message,
   exported the full OpenMLS checkpoint and committed it to IndexedDB. The actual text message queued behind every
   character's durable typing mutation, explaining the large delay even while the channel itself was healthy.
3. Reattaching React callbacks reported the current Open/Degraded state as `from === to`, which also called bootstrap
   `start()` and injected unnecessary hello frames.

### Fix

- Made `DirectMlsBootstrapSession.start()` strictly idempotent. Only the first start initializes the worker and emits
  hello. Added a separate `linkOpened()` operation for a real transition from a non-usable link state to Open/Degraded.
- Changed the application state bridge to call `linkOpened()` only on an actual reconnect. Attaching/replacing React
  callbacks while the connection remains open does not produce wire traffic.
- Marked typing as ephemeral: it is dropped until MLS is ready, limited to one in-flight operation, and throttled to at
  most one event per two seconds. Text and receipt operations remain ordered/durable MLS mutations.

### Regression verification

- The real Chromium worker test now asserts that repeated bootstrap `start()` calls emit no additional frame.
- Docker app build and the complete worker/browser flow passed.
- The two-browser real-Connection E2E types a long message character by character, receives it, sends a reaction back,
  observes no `Error sending data` console entry, and verifies that one local MLS checkpoint remains below the generous
  regression threshold that would distinguish throttled typing from one checkpoint write per character. Reciprocal chat
  deletion still passes afterward.

## 2026-08-04 — Short public MLS asset names

- Kept the generated Cargo/wasm-bindgen artifact names internal to `target/wasm-bindgen`, but publish the runtime files
  at the stable short URLs `/mls.min.js` and `/mls.wasm`.
- Minify the generated JavaScript glue during the existing webpack copy step with the already installed Terser tooling;
  no dependency or Rust build change was added. The emitted glue decreased from 21,166 to 9,357 bytes.
- Updated the worker defaults and browser/E2E assertions to use the public names. A Docker app build and the complete
  real-Chromium two-member, checkpoint, worker-restart and encrypted-storage flow passed against the emitted files.
- As an explicitly approved adjacent asset cleanup, webpack now publishes the ZXing reader as `/scanner.wasm`; the
  scanner bundle resolves that URL and the old `zxing_reader.wasm` output is absent after a clean Docker build.

## 2026-08-04 — Self-chat MLS capability check

- Ran the current WASM facade in real Chromium through Docker with one `EphemonMlsClient(0)` and no invited member.
  OpenMLS created the group successfully at epoch `0` with roster `[0]`, and it created an application message.
- Processing that ciphertext through the same client was rejected with `ValidationError(CannotDecryptOwnMessage)`. A
  one-member MLS group is therefore valid, but the application cannot model its transport loopback as an inbound message
  from a second MLS role or decrypt its own outbound MLS ciphertext.
- Reviewed `packages/ephemon-core/src/models/conversation.ts`. Only `ConversationId`, `MemberNumber` and their
  validators are consumed by the application; `Conversation`, `LegacyConversation`, `MlsConversation`,
  `ConversationMember` and `ConversationTransportLocator` are exported but otherwise unused. No code was changed pending
  review of the layer boundary.

### Next

1. Agree on the minimal application-layer self-chat behavior now that OpenMLS self-decryption is known to be invalid.
2. Decide whether the app-only conversation/member types should move out of the transport-only core package before
   continuing the self-chat fix.

## 2026-08-04 — Core layer cleanup

- Removed the unused `Conversation`, `LegacyConversation`, `MlsConversation`, `ConversationMember` and
  `ConversationTransportLocator` models and their exports from `ephemon-core`.
- Moved the actually consumed `ConversationId` and `MemberNumber` branded primitives and validators into
  `ephemon-app/src/types/conversation.ts`; core no longer exposes application- or MLS-level conversation types.
- Removed the stray `ephemon-core/test-support` directory together with the adversarial/crash-point tests that existed
  only for those helpers. Kept the core binary `Uint8Array` transport changes and the signaling-contract regression.
- Docker app build passed. A clean Docker core run passed all 40 test files and 417 tests. The first core invocation did
  not start because the mounted host `node_modules` lacked the Linux ARM Rolldown optional binding; reinstalling into a
  Docker-only volume resolved the environment mismatch without source changes.

### Next

1. Continue only with the reviewed application-layer self-chat fix; do not add MLS roles or conversation state to core.

## 2026-08-04 — MLS package name cleanup

- Renamed the Rust workspace package and directory from `ephemon-mls-wasm` to `ephemon-mls`.
- Updated the generated internal artifact names and the internal ABI-version export accordingly. The browser-facing
  asset URLs remain `/mls.min.js` and `/mls.wasm`.

### Verification

- Locked native Rust tests passed: 4 tests.
- Rust formatting, the release `wasm32-unknown-unknown` build with pinned `wasm-bindgen 0.2.100`, and the Docker app
  build passed against the renamed internal artifacts.
- The real-Chromium MLS smoke test passed ABI version `2`, two-member bootstrap, encrypted application messaging,
  checkpoint reload and worker restart using the unchanged `/mls.min.js` and `/mls.wasm` URLs.

### Next

1. Continue only with the reviewed application-layer self-chat fix.

## 2026-08-04 — Self-chat transport exception implemented

- Recorded accepted decision D-009: when the peer transport public key equals the local account public key, the app
  bypasses MLS and sends the existing JSON chat update as UTF-8 bytes through the binary Ephemon `Connection`.
- The self-chat branch neither starts `DirectMlsBootstrapSession` nor constructs `MlsWorkerClient`. Receive dispatch
  decodes the same transport bytes before invoking the existing chat reducer; ordinary peer connections retain the MLS
  control/application framing path.
- Replaced the earlier live-send test with the reported regression scenario: create and persist a self-chat, reload into
  a disconnected state, send a message, wait for `Try again?`, click it, reconnect, replay cached history and observe
  the outgoing message become `Delivered`.
- No core, saga, signaling, persistence or chat-replay behavior was changed.

### Verification

- Docker app production build passed.
- The exact self-chat Playwright regression passed through real Chromium and signaling in 18.3 seconds.
- The existing two-browser MLS direct-chat test passed afterward, including authenticated message/reaction delivery and
  reciprocal deletion, confirming that the bypass is limited to self-chat.
- `git diff --check` remains required after formatting this log. No commit was created.

### Next

1. Project-owner review of the restored self-chat behavior.
2. After review, continue the next approved Increment 6 item without changing core or signaling contracts.
