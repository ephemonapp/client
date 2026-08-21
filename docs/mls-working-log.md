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
5. Work on branch `feat/mls` and do not create commits unless the project owner explicitly approves a commit.
6. Run builds, tests, package installation and toolchains only through Docker. The host is used only to edit the working
   tree and orchestrate containers.
7. Keep the signaling server contracts and the two connection sagas unchanged unless a later accepted decision says
   otherwise.

## Current status

- Branch: `feat/mls`
- Current increment: Increment 6 MLS application events
- Commits: Increments 0–5 and the first Increment 6 cut are committed by the project owner; the current cut is
  uncommitted and no commit was created by the assistant
- Open product decisions: none

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

## 2026-08-04 — Increment 6: event identity decisions accepted

The project owner accepted the remaining Increment 6 shape. Recorded here because it fixes persisted formats:

- Record identity becomes an opaque string with a namespace prefix: `m:` is an MLS event addressed by the base64url
  SHA-256 of its canonical encoding, `l:` is a legacy chat-update record (which after D-009 includes self-chat), `d:` is
  a UI-only day separator. Provenance stays an explicit record field; the prefix exists so the codec boundary can assert
  that an `l:` identifier is never serialized into an MLS payload.
- Ordering becomes `(hlt.physical, hlt.counter, memberNumber, sequence, eventHash)`. The perspective-dependent
  `you < peer` tie-break is removed because two replicas order the same pair differently under it, which does not
  survive N members. Hybrid logical time is introduced now, not later, because the time component is inside the hashed
  canonical event; adding it afterwards would change the identity of all accumulated history.
- The separate `timestamp` field is replaced by `hlt.physical`, which is both the ordering component and the rendered
  send time. A remote event stamped further ahead of local `serverTime()` than the accepted skew is rejected rather than
  clamped, because clamping would change the event hash.
- History synchronization is preserved with no regression window. The trigger and the existing "resend only my own"
  semantics of `buildReplay` are kept; only the encoding changes from one bulk `history` update to individual MLS
  application events, and deduplication changes from `(id, sender)` overwrite to the event hash. The old path is removed
  in the same change that proves the new one, so the feature is never off.
- Own events are re-encrypted in the current epoch when replayed rather than resent as stored ciphertext: an old-epoch
  ciphertext may fall outside the receiver's retention window under §4.4, and an already-processed ciphertext is
  rejected by OpenMLS. Retaining the original ciphertext stays an Increment 6 deliverable for relay and saga failover.
- Event hashing uses WebCrypto SHA-256. An application event hash chain is not an MLS primitive, so this does not
  duplicate MLS in TypeScript; the alternative facade export would add a worker round-trip per hash without changing the
  guarantee. Keyed material remains MLS-owned: the D-004 comparison key must come from the MLS exporter secret and the
  D-006 resolution signature from the group-scoped signer.

### Completed in this cut

- Added `types/eventId.ts`: the branded `EventId`, the three namespaces, base64url conversion between an MLS event hash
  and its identifier, and validators that reject a malformed identifier or a legacy identifier used as an event hash.
- Added `mls/hybridLogicalClock.ts`: comparison, local stamping, advancing past an accepted remote event, and the
  bounded future-skew rule. A counter overflow moves to the next millisecond so authoring never depends on headroom.
- Added `mls/applicationEvent.ts`: the versioned canonical event envelope for `message.created`, `message.delivered`,
  `message.seen`, `reaction.set` and ephemeral `typing`. The envelope carries no author field, and typing carries no
  chain position so it stays outside the durable frontier. A reply targets an event hash, and may omit that hash when
  the quoted record is a local legacy one the peer cannot resolve. Decoding re-encodes and compares, so exactly one
  encoding maps to one identity.
- Extracted the `Writer`/`Reader` byte primitives from `directBootstrapProtocol.ts` into `mls/byteCodec.ts` and reused
  them in the new codec instead of duplicating them. The bootstrap frame's existing error strings are preserved through
  a label parameter; no bootstrap wire behavior changed.
- Extended the real-Chromium client harness with identifier, hybrid-logical-clock and event-codec assertions, including
  canonical round-trip per kind, distinct identifiers per event, a stable identifier for a repeated event, and rejection
  of trailing bytes, truncation, an unsupported version, an unknown kind, an unknown reply presence and a sequence that
  omits its predecessor.

### Verification

- Docker `@ephemon/app` build and TypeScript compilation passed. The first attempt failed on one real type error:
  `crypto.subtle.digest` requires a buffer backed by `ArrayBuffer`, matching this project's existing
  `Bytes = Uint8Array<ArrayBuffer>` convention, so the hash boundary now copies into its own buffer.
- Prettier reformatted the log and `applicationEvent.ts` (quoted property consistency); a repository-wide
  `prettier --check` then passed.
- Real Chromium passed the client harness, which now runs the identifier, hybrid-logical-clock and event-codec
  assertions ahead of the existing two-member MLS flow: ABI 2, epoch `1`, roster `[0, 1]`, encrypted checkpoint
  round-trip, injected-write rollback and worker restart. The executed `dist/mls.client-test.js` bundle contains the new
  assertion strings, so the new checks ran rather than being absent from the build.
- Complete Docker core suite: 40 test files and 417 tests passed, unchanged from the previous baseline. No core file was
  touched by this cut.
- The two-browser signaling end-to-end scenario was not run: this cut changes no application behavior, so it has nothing
  new to exercise. It becomes the gate for the identity switch and the replay step below.

### Next

1. Convert the application messaging boundary from "send this JSON string" to semantic operations, without changing
   behavior: `useEphemon` keeps serializing the same legacy chat update for both self-chat and MLS conversations.
2. Then switch identity and the MLS wire together: migration `006` rewriting encrypted message payloads from numeric
   `id` to `l:` strings, `chatStore`/`useChat`/UI keyed by `EventId`, day separators keyed by `d:`, `setOrder` taking an
   explicit time, the canonical event envelope on the wire, and receipts and reactions as independently authored events.
3. Then add the `conversation_events` store with the original ciphertext, persist the own-chain position atomically with
   the MLS checkpoint, and switch the replay path per event.

### Sequencing correction

An earlier plan in this log separated the identity switch from the wire switch. That split does not hold. Under the
legacy chat update the incoming identifier is a timestamp, so an MLS conversation would have to either trust the
sender's claimed identifier, which is not content addressing and breaks deduplication, or label an MLS-delivered message
with `l:` legacy provenance. Both are the kind of interim state this increment is meant to avoid, so identity and the
canonical event envelope must land as one change.

That also moves event construction out of the React layer: an event needs its chain position, and the chain position has
to be committed atomically with the MLS checkpoint, or a sequence reused after a crash forks the author's own chain.
`useChat` therefore calls semantic operations and the MLS boundary builds the event. The messaging boundary is converted
first, behavior unchanged, so the combined identity and wire change stays reviewable.

### Technical notes

- Own chain position (next sequence, head hash, hybrid logical time) must be committed atomically with the MLS
  checkpoint, because a reused sequence after a crash would fork the author's own chain. The existing checkpoint
  companion is already fully owned by the bootstrap session, which validates that the companion is a bootstrap frame, so
  the plan is to add a separate encrypted field on the same checkpoint record and keep both inside the one existing
  compare-and-swap transaction. The record payload is encrypted and the field is optional, so this needs no schema
  migration. Recorded as a storage-layout finding, not a protocol change.
- `.github/workflows/mls-wasm.yml`, recorded as added during Increment 0, was removed by the project owner because the
  job did not verify anything useful. The Rust/WASM path is therefore checked only through the Docker scripts
  `scripts/build-mls-wasm.sh` and `scripts/test-mls-wasm-browser.mjs`, by decision and not by omission.
- The legacy bulk `history` replay is still live for MLS conversations: `useChat` registers `onStateChanged` for every
  conversation, the first Open triggers `resendCached()`, and `onUpdate` still applies a nested `history` update. The
  earlier log entry claiming this was removed does not match the code, most likely because the shared hook was restored
  with self-chat under D-009. It is closed by the replay step above rather than by deleting the feature.

## 2026-08-04 — Increment 6: typed messaging boundary

### Completed

- Added `types/chatOperation.ts`. The UI now requests `typing`, `text`, `delivered`, `seen`, `reaction` or `replay`
  instead of handing a serialized chat update to the transport boundary.
- Moved legacy chat-update assembly out of `useChat` and into `useEphemon.toLegacyChatUpdate`, including the `you|peer`
  reply perspective flip and `buildReplay`. Both are legacy-protocol artifacts, so they belong at the boundary that
  still speaks that protocol and they disappear for MLS conversations in the next step.
- Replaced the `{ ephemeral: true }` send option with the operation kind: only `typing` skips waiting for MLS readiness,
  which was the sole use of that flag. The parallel option channel is gone.
- Kept the wire bytes identical for both paths: self-chat still sends the same UTF-8 JSON, and an MLS conversation still
  wraps the same JSON in the compatibility application payload. No identifier, ordering, persistence or protocol change
  is part of this step.
- Deliberately did not convert the receive direction. Its typed shape depends on the authenticated-author model that
  lands with the canonical event envelope, so converting it now would define that interface twice.

### Verification

- Docker `@ephemon/app` build and TypeScript compilation passed.
- Real Chromium, self-chat scenario: passed in 17.8s. This is the replay operation's regression, since the test sends
  while disconnected, retries, reconnects and requires the cached history to arrive and show `Delivered`.
- Real Chromium, two-browser signaling scenario: passed in 9.4s. It exercises every remaining operation through the new
  boundary against real MLS: both pages load `/mls.wasm`, Alice types a long text character by character, Bob renders
  it, Bob reacts, Alice renders the reaction, no `[connection-saga] Error sending data` entry appears, and Alice keeps
  one MLS checkpoint below the revision bound that would expose a lost typing throttle. Reciprocal chat deletion still
  removes the conversation on both sides.
- Prettier and `git diff --check` passed. No commit was created.

### Next

1. Switch identity and the MLS wire together, as recorded in the sequencing correction above.
2. Then the `conversation_events` store, the own-chain position committed with the checkpoint, and per-event replay.

## 2026-08-04 — Increment 6: event identity and the canonical wire

### Completed

- Record identity is now `EventId` end to end: model, chat store, persistence key, UI components and dev fixtures. An
  MLS event is addressed by the base64url SHA-256 of its canonical encoding, a legacy or self-chat record by
  `l:<timestamp>`, and a day separator by `d:<timestamp>`.
- Replaced `timestamp * 10 + rank(sender)` ordering with a comparator over `(timestamp, counter, author, sequence, id)`.
  The `you < peer` tie-break is gone, so two replicas order the same pair identically.
- Added migration `006`, which rewrites encrypted message payloads from a numeric `id` to `l:` and converts
  `reply_to.id` with it. It is idempotent: an already converted record is skipped.
- The MLS wire now carries the canonical event directly. The extra chat-update payload envelope was removed rather than
  nested inside the event, because the event already carries its own version and kind; `directApplicationProtocol.ts` is
  deleted.
- Receipts and reactions are independently authored events referencing the target event hash, and the author is derived
  from the processed MLS sender and mapped to a local sender only at the boundary.
- Added `mls/chatEvent.ts` (operation to event and back) and `mls/chatChain.ts` (authoring position). The chain position
  is committed in the same compare-and-swap transaction as the MLS checkpoint through a new encrypted field, so a
  sequence cannot be reused after a crash and fork the author's own chain.
- Replay for an MLS conversation resends this side's stored canonical bytes, so a replayed message keeps its identifier,
  and re-authors this side's own receipts on the peer's messages. The legacy path keeps its bulk update for self-chat.
- Removed the modules this change made dead: `lib/replay.ts`, `mls/memberMessage.ts`, the unused
  `AuthenticatedChatMessageType`, and the payload envelope above.

### Corrections found by the tests

- The first version returned the authored record only when the transport accepted it, which broke composing while
  disconnected: the self-chat scenario showed no bubble and therefore no retry affordance. A record is now authored
  regardless of link state for the legacy path, and only the send is conditional.

### Verification

- Docker `@ephemon/app` build and TypeScript compilation passed.
- Real Chromium harness passed with the canonical event as the MLS payload: two-member bootstrap, an authenticated
  message whose identifier equals the author's computed event identifier, and a rejected replay of the same ciphertext.
- Real Chromium, all three chat scenarios in one run: two-browser MLS 8.7s, offline compose 24.3s, self-chat 17.8s.
- Complete Docker core suite: 40 test files and 417 tests passed. Prettier and `git diff --check` passed. No commit.

### Known gap, now closed

- Composing while disconnected was broken for MLS conversations: the send path required a usable link before it could
  author, so a message typed while offline was dropped instead of queued. Fixed by separating authoring from sending.
  Authoring resolves the roster from the persisted `mlsBootstrap` record, initializes the worker from its committed
  checkpoint and takes the chain position from it; only the frame send checks the link. Typing stays dropped when the
  link cannot carry it, because it is ephemeral and must not consume a chain position.
- Added `tests/offline-compose.spec.ts` for it: two browsers exchange one MLS message so the roster is persisted, Alice
  reloads into a disconnected state, composes, and the bubble appears with its retry affordance; after retry the message
  reaches Bob and Alice's copy shows `Delivered`. This is the first regression that proves an offline-authored MLS event
  keeps its identifier and is delivered by the replay path rather than re-authored.

### Still not covered

- Replies have no automated coverage, which is why manual verification was requested. The reply perspective now crosses
  two codecs, so it needs a two-browser assertion on the quote attribution.
- These scenarios drive the live signaling server, and two flaky runs were observed today: once the initial unlock timed
  out waiting for the core's public key, and once both MLS scenarios failed inside a combined run that took 3.4 minutes
  instead of the usual one, then all three passed on the next combined run in 57 seconds. Recorded rather than papered
  over with longer timeouts, since the cause is environmental and unknown.

## 2026-08-04 — Self-chat regression: directional legacy identity

### Report

The project owner tested locally and found that in self-chat the message no longer appeared as the peer's copy and read
receipts stopped arriving. Both symptoms came from one modelling error in the previous cut.

### Root cause

Self-chat is a loopback, so one message legitimately exists twice: once as authored and once as received. The previous
row key `${sender}:${id}` kept those apart. Making the identifier the key collapsed them, because both copies carried
the same `l:<timestamp>`: the inbound copy hit the duplicate check in `ChatStore.add` and was dropped, and a receipt
patched whichever single row existed rather than the authored one.

Migration `006` had the same defect and was worse: it rewrote both `you:<ts>` and `peer:<ts>` to one `l:<ts>`, merging
two existing rows of already stored self-chat history.

### Fix

- A legacy record's identity is its natural key, direction and timestamp: `l:you:<ts>` and `l:peer:<ts>`. An MLS event
  needs no direction because its hash already commits to its authenticated author.
- The legacy wire went back to the original numeric identifier. Direction is implied by the update kind, so the codec
  resolves it locally: a `message` becomes the peer's record, and a receipt or reaction targets the authored record.
  This also removed the older-build tolerance the previous cut had added to the wire types.
- Migration `006` now derives direction from each record's own `sender`, and a reply target from the reply's `sender`.

### Verification

- Extended `tests/self-chat.spec.ts` with the two assertions that would have caught this: the loopback peer copy must
  exist, and the authored copy's receipt must reach `Seen`. It passes, and the previous cut could not have passed it,
  because the peer copy never entered the store.
- Docker build, real-Chromium harness including a new assertion that the two directions of one timestamp do not
  collapse, all three chat scenarios in one run (MLS 9.6s, offline compose 19.8s, self-chat 17.6s), core suite 40 files
  and 417 tests, Prettier and `git diff --check`. No commit.

### Deliberate omissions

- No explicit `provenance` field. Nothing reads it, and after D-010 the identifier namespace already says whether a
  record is an MLS event or a self-chat record. It was previously deferred to Increment 9 for imported legacy records,
  which no longer exist.

## 2026-08-04 — D-010: pre-MLS support deleted

### Decision

The project owner pointed out that the messenger has no released clients, so carrying pre-MLS history is pure cost.
Recorded as D-010, which supersedes D-004 and rewrites Increment 9 from a migration protocol into a deletion.

One correction was needed before implementing it: self-chat is not legacy. OpenMLS rejects decrypting its own message
(`CannotDecryptOwnMessage`), so a one-member group cannot model the loopback, and D-009's chat-update transport is
permanent rather than scheduled for removal. Its records therefore keep a direction-scoped identity, and the ordering
tie-break by direction exists for exactly those records.

### Completed

- Replaced migrations `001`–`006` and the old-vault import with one `001_initialize` that creates `meta`, `keys`,
  `connections`, `messages` and `mls_checkpoints` and performs no data conversion. Removed `migrations/legacy.ts`,
  `hasLegacyVault`, `verifyLegacyPassword`, the unlock branch that called them, and the now-unused `cache` store name.
- Withdrew the quoted-pre-MLS-record locator that had just been added to the reply body. Every reply targets an MLS
  event hash again, so the reply block is one presence byte plus the hash.
- Renamed everything that called the surviving non-MLS path "legacy": the record namespace is `s:you:<ts>` and
  `s:peer:<ts>`, `lib/legacyChatUpdate.ts` became `lib/selfChatUpdate.ts`, and `utils/legacyTextConnection.ts` became
  `utils/selfChatTransport.ts`, with the exported names following.
- Updated the plan's decision list, Increment 9 and the resolved checklist to match.

### Verification

- Docker build and TypeScript compilation passed. Prettier passed.
- Real Chromium harness passed, including the identifier assertions and the reply round-trip against an event hash.
- All three chat scenarios in one run: two-browser MLS 9.6s, offline compose 20.0s, self-chat 16.4s.
- Core suite: 40 test files and 417 tests. No commit was created.

### Notes

- The IndexedDB name is deliberately unchanged, so a vault written by a pre-MLS build is not upgraded and not replaced
  automatically; its records would fail identifier validation on read. The project owner clears the database in the
  browser before testing. Playwright contexts start empty, so the scenarios are unaffected.
- `git diff --check` reports trailing whitespace on the two `Status:` lines touched in `mls-decisions.md`. Those two
  spaces are the Markdown hard break every decision entry in that document already uses, so the style was kept rather
  than making two entries render differently from the rest. Worth a separate decision if the document should be
  restyled.
- The hybrid logical clock is derived from persisted records rather than stored. Writing it separately after processing
  an inbound event would leave a crash window where the clock trails an accepted event, which is exactly the causality
  the clock exists to preserve. Only the authoring position, which must be atomic with MLS state, is persisted.
- No separate `conversation_events` store. §6 describes that record as original wire bytes plus authenticated author
  plus decoded local view, which is the existing encrypted `messages` record with three fields added; two stores holding
  one history would mean double bookkeeping and a join on every chat open. Same precedent as the `connections` store
  keeping its name while gaining `kind` and `protocol`.

## 2026-08-04 — Increment 6 closed, Increment 7a: durable event records

The project owner committed the work up to and including D-010 as `61fb65b`.

### Increment 6 closed

- Added `tests/reply.spec.ts`, the coverage that was missing: Bob quotes Alice and the quote reads as the peer's for Bob
  and as their own for Alice; clicking it on Alice's side highlights her copy of the quoted event, which proves the
  target hash resolved across replicas; Alice then quotes herself and both sides agree again.
- Added `replyToOwn` and `quoteOf` to the scenario support object.

### Increment 7a: every durable event is its own record

- Added `types/chatRecord.ts`. A stored record is either a message or a receipt/reaction that references its target. The
  message record type explicitly omits `delivered`, `seen` and `reaction`, so receipt state cannot be written back onto
  it; that projection is recomputed from receipt records. The type change immediately caught the dev fixtures writing
  receipt state into message records.
- `ChatStore` now ingests records: `hydrate` and `apply` replace `add`/`patch`, `getRecord`/`getRecords` expose the log
  for persistence and replay, and a receipt that arrives before its target is held and applied when the target lands.
  That holding behaviour is what out-of-order anti-entropy delivery will need.
- Both codecs return a record for every durable operation, and the inbound event collapsed to
  `{ kind: 'typing' } | { kind: 'record'; record }`, so send and receive speak the same vocabulary.
- Self-chat record identifiers gained a kind segment, `s:<direction>:<kind>:<timestamp>`. Without it a receipt authored
  in the same millisecond as a message would collide with it now that both are rows. Local format only; the wire still
  carries the bare timestamp.
- MLS replay no longer re-authors receipts. It resends the stored canonical bytes of every own record, so a replayed
  receipt keeps its identifier and its chain position instead of consuming a new one on every reconnect. This is the
  prerequisite for a frontier: a peer can only ask for missing sequences if every sequence is servable.

### Verification

- Docker build, real-Chromium harness, all four chat scenarios in one run (MLS 9.3s, offline compose 20.5s, reply 6.9s,
  self-chat 17.7s), core suite 40 files and 417 tests, Prettier clean.

### Incident: Prettier reformatted 36 unrelated files

- A Docker invocation mounted `packages/ephemon-app` as the working root because the shell's directory had changed, so
  Prettier did not find the repository `package.json` and ran with its defaults. It rewrote 36 files to two-space
  indent, double quotes and 80 columns.
- Re-running Prettier from the real root restored indentation and quotes, but not line width: Prettier keeps an object
  literal expanded when the source has a newline after the brace, so the damage is sticky and cannot be undone by
  reformatting.
- Recovery: the 25 files that this work does not touch were restored from `HEAD`, and `database.ts` was redone from
  `HEAD` because its collateral re-wrapping was an order of magnitude larger than the real change. The remaining eleven
  files carry some incidental re-wrapping mixed into changes that are large anyway.
- Prevention: always pass an absolute repository path to `docker run -v`, never `$PWD`.

### Next

1. Increment 7b: per-author frontier, then inventory, request, batch and acknowledgement control frames replacing the
   resend-everything replay.
2. Increment 7c: ancestry verification for commit heads, and history-clear semantics that do not destroy live MLS state.

## 2026-08-04 — Increment 7b: inventory-driven synchronization

### Simplification of the planned frame set

§4.3 sketches four control frames: inventory, request, batch and acknowledgement. One is enough.

The inventory carries, per author, the highest contiguous sequence, that position's event hash and an explicit list of
holes. Because the holes are explicit, the receiving side already knows what to send, so `request` is unnecessary. It
sends those events through the existing application path, so `batch` is unnecessary. The next inventory reports what
actually arrived, so `ack` is unnecessary and cannot drift out of sync with reality.

The frame travels inside MLS as an ephemeral application event. It carries member numbers and event hashes, which §3.1
forbids in a clear link header, and it takes no chain position, so a summary never leaves a gap in the durable frontier.

### Completed

- Added `mls/chatFrontier.ts`: frontier computation from stored records, the diff that answers what a peer is missing,
  and a canonical codec. Decoding rejects an unordered or oversized hole list and a head that disagrees with the
  contiguous position.
- Added the ephemeral `sync.inventory` event kind. `isDurableApplicationEvent` now tests a set of ephemeral kinds rather
  than comparing against `typing`, so adding another ephemeral kind cannot silently start consuming sequences.
- The boundary handles inventories itself and never forwards them to the chat layer: `acceptChatEvent` returns an
  inventory variant that `useEphemon` intercepts, so synchronization stays out of the UI vocabulary.
- Replaced the `replay` operation with `sync`. For self-chat it still sends the bulk chat update, which is that
  protocol's only convergence mechanism. For an MLS conversation it now sends an inventory instead of re-encrypting the
  entire own history on every reconnect.

### Verification

- Docker build, real-Chromium harness, all four chat scenarios in one run (MLS 10.3s, offline compose 20.2s, reply 7.0s,
  self-chat 17.9s), core suite 40 files and 417 tests, Prettier and `git diff --check`.
- The offline-compose scenario is the meaningful one here: the message Alice authors while disconnected is now delivered
  because Bob's inventory tells Alice what he lacks, not because Alice blindly resends everything.

### Not yet measured

- The efficiency claim is unproven by the current tests. With two messages, blind resend and inventory-driven sync move
  the checkpoint revision by a comparable amount, so the scenarios cannot distinguish them. Distinguishing needs roughly
  fifty messages and two reconnects, asserting that the second reconnect adds almost no checkpoint revisions. That is a
  soak-shaped test and belongs with Increment 10 rather than being faked here.

### Next

1. Increment 7c: ancestry verification for commit heads, and history-clear semantics that do not destroy live MLS state.
2. Then Increment 8: versioned `CommitPolicy`, proposal queue, single-writer tab lock, bounded epoch retention and fork
   quarantine with owner-selected resolution.

## 2026-08-04 — Increment 7c: durable history clearing

### New behavior, hand-testable

Clearing history is now a decision this replica remembers rather than a gap the peer fills back in. Before this change,
and made systematic by the inventory exchange, clearing advertised "I have nothing" on the next reconnect, so the peer
dutifully re-sent everything and the history came back.

- A clear records a per-author watermark of the positions it deliberately dropped, persisted in the encrypted
  conversation record. The frontier merges it, so an inventory advertises those positions as satisfied while the store
  holds no records for them.
- The watermark is written before the records are deleted. A crash in between therefore leaves the watermark set and the
  records still present, which is the harmless order: the clear simply did not finish. The reverse order would resurrect
  the history.
- A cleared position advertises no head hash. The head exists to detect author equivocation, and this replica cannot
  vouch for content it dropped; claiming a zero hash would be a lie the peer could not distinguish from a real one. The
  frontier codec therefore no longer couples head presence to the contiguous position.
- The MLS chain is untouched by a clear. The authoring position stays in the checkpoint, so the author's own chain does
  not fork and both directions keep working afterwards.

### Corrected by the test

The first implementation computed the watermark from the store after `ChatStore.clear` had already emptied it, so the
watermark was always empty. `tests/clear-history.spec.ts` caught it precisely: Alice's own message stayed gone while
Bob's came back. The dropped records now travel with the `clearAll` mutation, so the boundary computes the watermark
from what was actually removed.

### Verification

- `tests/clear-history.spec.ts`: two browsers exchange a message each way, Alice clears, Bob keeps his copy, Alice
  reloads and reconnects, neither message returns, Bob still has Alice's, and both directions still deliver afterwards.
- All five chat scenarios in one run: clear history 13.1s, MLS 9.3s, offline compose 21.1s, reply 7.3s, self-chat 17.5s.
- Real-Chromium harness, core suite 40 files and 417 tests, Prettier and `git diff --check`.

### What the project owner should check by hand

1. Exchange messages in a direct chat, clear history on one side, reconnect: it must stay empty, and the other side must
   keep its copy.
2. Send in both directions after clearing: ordering and receipts must behave normally, which is what proves the MLS
   chain survived.
3. Clear history in self-chat: that path still uses the chat-update protocol, where the bulk replay is the only
   convergence mechanism, so the peer copy legitimately returns there.

### Next

1. Increment 7c remainder: ancestry verification for commit heads before accepting a longer history.
2. Then Increment 8: versioned `CommitPolicy`, proposal queue, single-writer tab lock, bounded epoch retention, fork
   quarantine with owner-selected resolution.

## 2026-08-04 — Convergence defect found by the project owner

### Report

Cleared history stayed cleared across an ordinary reconnect, but after restarting the app on both sides and
reconnecting, the peer's previously cleared messages came back.

### Diagnosis

The clear-history scenario was extended to the reported sequence and still passed, so the watermark was not the cause.
Temporary `[diag]` logging of every inventory and every serve decision showed the real shape: after a reconnect only one
side sent an inventory. The other side never learned what it was missing, so whatever that side had to offer stayed put.
Two consequences of the same defect:

- convergence depended on both sides independently deciding to start a sync, and a side whose link went Open without
  passing through Closed keeps `hasBeenOpened` set and never starts one;
- an author absent from an inventory was read as "has nothing", so a partial inventory could make the peer re-send that
  author's whole chain, which is the signature the project owner saw: the peer's messages returned while their own did
  not.

### Fixes

- An inventory now answers with an inventory. A received inventory that is not itself a reply triggers one back, so the
  exchange is symmetric and it does not matter which side initiates. The single reply flag makes it terminate.
- An inventory always lists every roster member, with a contiguous position of `-1` when nothing is known, so "absent"
  never has to be interpreted.
- The clear watermark is computed from the persisted messages merged with the records the mutation dropped, rather than
  from whatever the live store happened to hold.

### Verification

- The `offline-compose` scenario caught the regression the roster change introduced and now passes for the right reason:
  the diagnostic trace shows Alice's inventory, Bob serving it and replying with his own, and Alice then sending what he
  lacked.
- All five chat scenarios in one run: clear history 21.1s, MLS 10.1s, offline compose 20.0s, reply 6.7s, self-chat
  16.6s. Real-Chromium harness, core suite 40 files and 417 tests, Prettier and `git diff --check`.

### Left in place deliberately

- The `[diag]` logging stays for now at debug level, so a recurrence can be diagnosed from the in-app log instead of
  guessing. It should be removed before the hardening gate.
- The trace also shows a side occasionally under-reporting its own chain, which makes the peer push that side's own
  events back to it. Harmless and idempotent, but wasteful: an inventory should clamp its own author entry using the
  authoring position from the checkpoint, which is authoritative even before the store has hydrated. Recorded as the
  next hardening item rather than fixed inside this bug.

## 2026-08-05 — Cleanup after the convergence fix

- Removed the temporary `[diag]` logging and the console listeners the two scenarios used to capture it, now that the
  behavior is covered by tests rather than by reading traces.
- Closed the loose end the traces exposed: an inventory now clamps its own author entry with the authoring position from
  the checkpoint, which is authoritative even before the store has hydrated. A side can therefore no longer under-report
  its own chain and make the peer push that side's own events back to it. The clamp drops the head hash for the clamped
  position, because a position known only from the chain state has no event hash to vouch with.
- Verified: all five chat scenarios in one run (clear history 19.2s, MLS 8.0s, offline compose 20.9s, reply 7.3s,
  self-chat 17.5s), real-Chromium harness, core suite 40 files and 417 tests, Prettier and `git diff --check`.

### Next

Increment 8. Starting with the single-writer tab lock, because it is the part of that increment that is visible by hand:
a second tab of the same conversation must become a read-only observer instead of a second MLS writer. Then the
versioned `CommitPolicy`, the proposal queue, bounded epoch retention, and fork quarantine with owner-selected
resolution.

Ancestry verification for commit heads moves into Increment 8 rather than closing 7c on its own: today the only commit
is the bootstrap add, epochs do not advance afterwards, and there is nothing yet whose ancestry could be checked. It
becomes meaningful together with the commit traffic that Increment 8 introduces.

## 2026-08-05 — Increment 8: single-writer tab lock

### New behavior, hand-testable

A second tab of the same account no longer becomes a second MLS writer. It shows the saved history, says so, and cannot
author anything. Closing the writing tab promotes it.

- `lib/writerLock.ts` holds an exclusive Web Lock for the lifetime of the tab: the lock callback never resolves, so the
  browser releases it only when the tab goes away, and a waiting tab is promoted automatically.
- Where Web Locks are unavailable the tab assumes it is the writer, which is the current behavior rather than a new
  risk. The IndexedDB lease fallback §6 mentions is not implemented and is recorded below.
- An observer creates no transport for a conversation, refuses outgoing sends, and ignores incoming connections. This is
  deliberate rather than cosmetic: receiving a message means processing it through OpenMLS, which is a state mutation,
  so a tab that must not mutate also cannot receive.
- Promotion re-initializes the conversations instead of waiting for a reload.
- The UI states it plainly in the chat footer and disables the composer.

### Why the lock is per account rather than per conversation

The MLS worker and the checkpoint store are one instance per app, and the danger is not conversation-specific: two tabs
advancing the same authoring position would reuse a chain sequence and fork the author's own chain, which D-005 treats
as equivocation. One writer per vault is the conservative boundary and matches what the worker actually is.

### Verification

- `tests/single-writer.spec.ts`: the first tab writes, the second tab reads the same history, shows the notice and has a
  disabled composer while the first has neither; closing the first promotes the second, whose composer becomes enabled
  and which then successfully sends.
- All six chat scenarios in one run: clear history 19.5s, MLS 9.4s, offline compose 20.0s, reply 7.0s, self-chat 17.6s,
  single writer 6.2s. Real-Chromium harness, core suite 40 files and 417 tests, Prettier and `git diff --check`.

### Not done in this cut

- No command forwarding to the owner tab. §6 describes observers forwarding commands; this cut only makes them
  read-only, which is the safety half. Forwarding needs a BroadcastChannel request/response protocol and is a separate
  piece of work.
- No IndexedDB lease fallback for browsers without Web Locks, and no stale-tab fencing token yet. Both belong with the
  rest of Increment 8.

### What the project owner should check by hand

1. Open the app in a second tab of the same browser profile: it must show saved history, say another tab is active, and
   have a disabled composer.
2. Close the first tab: the second must lose the notice, become able to send, and reconnect on its own.
3. Confirm the first tab is unaffected while both are open.

## 2026-08-05 — Cross-tab history sync, and a course correction

### Reported defect

Messages written in the writing tab did not appear in the observer tab, and survived a reconnect and even a peer reply:
only reloading the observer showed them.

Cause: an observer hydrates its store from the vault once at mount and had no way to learn about later writes. Promotion
re-initialized the connections but not the store. The clamp added earlier then made it permanent rather than
self-healing: the promoted tab correctly advertises its own chain as complete, so the peer has no reason to re-send the
records the tab is missing locally.

### Fix

- `lib/tabSync.ts` announces every persisted history change on a `BroadcastChannel`, and every tab re-reads that
  conversation and merges it into its store. An observer therefore stays current while it observes, and a promoted tab
  starts from a complete store.
- A clear is announced as such, since merging cannot express a removal.
- `saveHistory` and `clearHistory` are now explicitly refused for a non-writer. An observer was never supposed to write;
  before this it merely happened not to, because it had nothing to write.

### Verification

- `tests/single-writer.spec.ts` extended: while the second tab observes, the writing tab sends and the observer must
  show it without a reload; after promotion, both the message written before it opened and the one written while it
  observed are still there, and it can send.
- All six chat scenarios in one run: clear history 21.2s, MLS 8.7s, offline compose 20.7s, reply 6.9s, self-chat 16.8s,
  single writer 6.3s. Real-Chromium harness, core suite 40 files and 417 tests, Prettier and `git diff --check`.

### Course correction

The project owner observed that the tab lock does not move the work toward group chats. That is correct in substance.
The lock is an Increment 8 deliverable, so it is on the plan, but it is a quality property rather than a group
primitive, and it was chosen because it was the part of Increment 8 that could be verified by hand. The trade was not
worth it.

The group-critical remainder is narrow and specific:

- the versioned `CommitPolicy` with the staged inbound-commit authorization it exists for, because a group needs
  membership commits and a rule for who may create them;
- the commit log with parent and result heads, and ancestry verification before accepting a longer history;
- then the §10 items that are genuinely about groups: an `N`-member roster preserving member numbers across leaf moves,
  membership proposals with Welcome forwarding, a transport orchestrator that keeps trying every active roster locator,
  and relay of opaque events through any connected member.

Everything else in Increments 8 through 10 is hardening that a two-member chat also wants, and none of it blocks the
four items above.

## 2026-08-05 — Increment 8: commit authorization down to the facade

First of the four group-critical items. No UI: this is the rule by which a commit is accepted, which a group needs
because membership changes are commits.

### Rust facade, ABI 3

- `create_self_update` produces a commit any member may author, which is both the Increment 8 self-update deliverable
  and the only way to exercise authorization without a membership change.
- `process_incoming_commit(bytes, authorized_committers)` processes the message, resolves the authenticated sender to a
  member number, refuses the commit if that number is not in the caller's list, and only then merges the staged commit.
  It also reports what the commit did: the epoch it produced and the member numbers it added or removed.
- Authorization deliberately stays outside the facade. The caller passes the member numbers its policy allows, so
  `OwnerOnly` can be replaced without touching the bindings, which is what D-003 requires.
- `epoch_authenticator` exposes a value that identifies the epoch's transcript without revealing group secrets. §4.1
  asks for the confirmed transcript hash; OpenMLS's epoch authenticator serves the same purpose and is a supported
  accessor, so the commit head will be built from it.
- ABI raised to 3, and the worker, the browser script and the typed client were raised with it.

### Verification

- Native Rust: 6 tests. Two are new. An unauthorized commit does not merge and does not advance the epoch. An authorized
  commit merges, reports sender 1 and epoch 2, both members end on the same epoch head, and messaging continues in the
  new epoch.
- Real Chromium through the typed worker client: the same authorization rule holds end to end, the refused commit leaves
  the epoch at 1, the authorized one moves both sides to 2, and the two epoch authenticators match.
- App build, all six chat scenarios, core suite 40 files and 417 tests, Prettier, Rust fmt, `git diff --check`.

### Note on the toolchain

The wasm-bindgen output has to be produced with the repository's `target/` visible on the host. Mounting a named volume
over `target/` silently keeps the artifacts inside the volume, so the app then publishes a stale `.wasm` and the ABI
check fails in a confusing way. Build the WASM with only the cargo registry mounted as a volume.

### Next

Item 2 of four: the commit log with parent and result heads, the commit head in the inventory exchange, and the three
ancestry rules from §4.1 — equal heads, verified descendant, and fork detection. Then the `N`-member roster.

## 2026-08-05 — Increment 8: commit log, commit head exchange, fork detection

Second of the four group-critical items.

### Completed

- Added the `mls_commits` store through migration `002` and the encrypted commit record from §6: resulting epoch and
  authenticator, the parent it applied to, and the original commit bytes.
- Added `mls/commitLog.ts`. `relateHeads` implements §4.1 without trusting length: equal epoch with a different
  authenticator is a fork, a higher remote epoch only means this side is behind, and the ancestry itself is proven when
  each received commit is validated by OpenMLS against the local group context.
- The inventory now carries the commit head alongside the application frontier, so §4.3's first two steps happen in one
  exchange. Fork detection pauses MLS traffic for that conversation and reports it.
- Added a `commit` wire frame. A commit is an MLS handshake message, so it travels as itself: the first attempt sent it
  through `createApplicationMessage`, which would have wrapped a handshake message inside an application message.
- An incoming commit is authorized before it merges. The authorized committer is read from the persisted roster's owner,
  which is `OwnerOnly` expressed as data rather than as a condition in the code, and then recorded in the commit log.

### Verification

- App build, real-Chromium harness at epoch 2, core suite 40 files and 417 tests, all six chat scenarios, Prettier, Rust
  fmt, `git diff --check`.
- No wire-level test of the commit path yet, because nothing in the app produces a post-bootstrap commit. That arrives
  with the add-member flow, which is where this machinery gets exercised for real.

### Next

Item 3: generalize the roster to `N` members. The persisted conversation still records exactly one peer, and
`DirectMlsMembership` is a two-member shape, so the add-member flow has nowhere to put a third participant. Then item 4,
the add-member exchange with Welcome forwarding, which is the first thing here that can be shown: a three-member chat
where a message reaches both other members.

## 2026-08-05 — Item 3, part one: a conversation may hold several transports

The gate to a group demo was structural: a conversation was bound to exactly one `Connection`, so a third participant
had nowhere to attach. A conversation now owns a set of transports keyed by locator, registered wherever a connection is
bound and dropped with the conversation. Sending an application event or a commit writes to every usable transport
instead of to the single peer.

For a two-member conversation the set holds exactly one entry, so behavior is unchanged, which is what the six scenarios
confirm. What this unblocks: the add-member flow can attach the new member's transport to the same conversation, and a
relayed event has somewhere to go.

Still two-member-shaped, and next: `DirectMlsMembership` and the persisted `mlsBootstrap` record, which both name
exactly one peer. Then the add-member exchange with Welcome forwarding.

## 2026-08-05 — Group membership: model and exchange in place, routing not yet

Done, tree green:

- `DirectMlsMembership` carries `owner` and a roster of `{memberNumber, publicKey, serverUrl}`; the roster is persisted
  in the conversation record and restored, including on the offline-authoring path.
- A conversation owns a set of transports keyed by locator. Application events and commits go to every usable transport.
- `invite` wire frame: routing ID, the member number assigned to the joiner, the owner, and the roster with locators.
  The joiner needs its number before it builds a KeyPackage, because the credential is the number.
- `MlsInviteOwnerSession` and `MlsInviteJoinerSession`: invite → keyPackage → stage add and merge → addMember(commit,
  welcome) to the joiner and commit to the existing members → joined. The owner updates and persists the roster; the
  joiner adopts the roster it was sent and adds itself.

Not wired, and the reason: bootstrap and invite sessions are keyed per conversation today, but with several transports
per conversation they must be keyed per peer. `handleConnectionMessage` has to route a frame by which session owns that
peer, and the incoming side has to recognise an `invite` on a fresh connection instead of starting a two-member
bootstrap. That is the next change; the invite sessions above are unreferenced until it lands.

## 2026-08-05 — Member add: wired end to end, three-member scenario not passing yet

Wired: sessions keyed per peer inside a conversation; `invite` routed to a joiner session; the invitee transport's
two-member bootstrap chatter ignored by the owner; owner API `addMember(id, publicKey)` that dials the invitee, attaches
its transport to the existing conversation, stages the add, merges, sends `addMember` to the joiner and `commit` to the
existing members, and persists the new roster; kebab item and modal; the joiner announces its frontier after joining.
Author checks now accept any roster member instead of the single peer, in the receive guard and in the view adapter.

`tests/group-chat.spec.ts` does not pass yet. Two real findings from its console output:

- A new member cannot decrypt history from before it joined: `UnableToDecrypt(TooDistantInThePast)`. That is correct MLS
  behavior, so `serveInventory` must not offer events from epochs a member was not in. The frontier needs a per-member
  join epoch.
- The receive guard rejected messages from the third member because it compared against `peerMemberNumber`. Fixed.

Remaining: the invitee's row appears only intermittently, which points at `addConversationMember` awaiting
`connection.open()` before sending the invite; the invite should be sent when that transport reaches Open instead.

The two-member suite is unaffected: delete-chat, offline compose, reply and self-chat all pass.

## 2026-08-10 — Group add: flow complete, scenario still red

Green: build, the two-member suite (delete-chat, self-chat, offline compose, reply, single writer, clear history), core
suite, harness.

Red: `tests/group-chat.spec.ts`. It passed once in isolation, so the path works end to end; it is not stable.

Fixed along the way:

- the invite now goes out when the invitee's transport reaches Open, not after an awaited `open()`;
- the invitee transport is initialized through `connectionInitializedAwaiter` before opening, like every other dial;
- the invite session is registered before the transport is bound, because binding immediately reports the current state
  and a two-member bootstrap must not start on a transport that belongs to the member-add exchange;
- only the dialling side starts a bootstrap; the receiving side reacts to the first frame, which may be an invite;
- records carry the epoch they were authored in, roster members carry the epoch they joined at, and serving skips events
  from before a member's join. That removed the `TooDistantInThePast` failures: a new member cannot decrypt history from
  epochs it was not in, so offering it that history was wrong.
- the receive guard and the view adapter accept any roster member as an author instead of a single peer.

Remaining fault, precisely: a two-member bootstrap is still being created for the owner-to-invitee transport, and it
initializes the worker with a member number derived from comparing the two transport keys instead of the number the
roster already assigned. The worker rejects it with
`MLS checkpoint member number does not match the conversation roster`, which then leaves that session unusable. The
membership for a transport must come from the conversation's roster whenever one exists, and `assignDirectMlsMembership`
must only be used when a conversation has no roster yet.

## 2026-08-10 — Member add: handshake works, existing member does not apply the commit

The invite handshake now completes cleanly, with no errors: owner sends `invite`, joiner accepts as member 2, key
package back, add staged and merged, `addMember` to the joiner and `commit` to the members, joiner joins at epoch 2.

Bugs found and fixed to get there:

- the invite session map was created but never stored in its ref, so every lookup missed and the owner fell back to a
  two-member bootstrap toward the invitee;
- `addMember` was invoked inside a React state updater and did not run;
- invite sessions are now keyed by peer alone rather than by conversation and peer, which removed a class of lookup
  mismatches;
- an invitee's transport is excluded from application and inventory sends until it has joined, and neither the state
  change nor the send path starts a bootstrap on it;
- serving only offers records from the live epoch, since a stored ciphertext decrypts only in the epoch it was made in.

Remaining, precisely: the existing member receives the `commit` frame (`received frame commit` is logged) but never
completes the branch, since the `advanced to epoch` line that follows `processIncomingCommit` never appears, and no
error is raised. It then fails to decrypt the next application message with `TooDistantInThePast`, which is consistent
with still being at the previous epoch. Next step is a log immediately inside that branch to see whether it stalls on
`waitForDirectMls` or on `inspect` inside `ownCommitHead`; a previous attempt to add that log silently failed to match
after formatting, which is why it is still missing.

Temporary `[invite]` console.debug instrumentation is still in `useEphemon.ts` and `MlsInviteSession.ts`.

## 2026-08-10 — Three-member group chat is green

`tests/group-chat.spec.ts` passes: the owner adds a third member, the new member's own message reaches the owner, and
the owner's next message reaches both other members, all in epoch 2 of one MLS group.

Two real defects were behind the earlier failures, and neither was in the invite exchange itself.

**A transport binding reset the conversation's group state.** `bindConnection` cleared the bootstrap session, the ready
membership and the offline authoring cache. That is correct when a conversation's own link is opened, since it forces a
fresh bootstrap; it is wrong when a member's transport is added to a group that already exists. The owner therefore lost
its ready membership at the moment it dialled the invitee, the next message found `ready === false`, and
`waitForDirectMls` started a _second_ two-member bootstrap on the primary transport. The owner and the existing member
silently moved into a brand-new group at epoch 1 while the invitee was joining the abandoned one, which is exactly the
`TooDistantInThePast` the new member reported. Binding is now split: `bindTransport` wires the handlers only, and
`bindConnection` is that plus the conversation reset. Adding a member binds a transport.

**The tab-sync channel fed a tab its own writes.** A `BroadcastChannel` does not deliver to the instance that posted,
but `publishHistoryChange` and `subscribeHistoryChange` each opened their own instance, so a write published by a tab
came back to the same tab, was hydrated into the store, persisted again and published again. The render audit measured
`clear history` at 8930 React commits and 20499 component renders over 17 seconds. Both sides now share one channel per
tab: `clear history` is 5 commits and 14 renders, `delete chat` 4 and 14, and the whole audit runs in 40s instead of
162s.

The test also had to be sequenced correctly rather than patched around. A transport opens well before the Welcome
arrives, so `carol.rows` and a connected state do not mean the invitee is in the group, and an event authored in the
epoch before a member joined is deliberately not served to that member. The test now waits for a message the new member
encrypts herself, which is only possible once she holds the group's epoch-2 keys.

### Verification

- All 20 Playwright specs except the render audit pass, including `group-chat`, `single-writer`, `clear-history`,
  `reply`, `offline-compose`, `delete-chat` and `self-chat`.
- Core suite: 40 files, 417 tests.
- Chromium MLS harness: ABI 3, two-member restart, worker restart, encrypted checkpoint store, typed worker client.
- `prettier --check` clean over `packages`, `docs` and `scripts`; `git diff --check` clean.
- Temporary `[invite]` instrumentation removed from `useEphemon.ts`, `MlsInviteSession.ts` and the group spec.

### Render audit: what is still over budget

The storm is gone, but seven budgets written for the pre-MLS app are still exceeded, all by small amounts and all from
conversation-level state that MLS added: `clear history` renders 14 against a budget of 12 and touches the sidebar,
because the clear watermark lives on the conversation record; `connect to peer` and `reconnect to peer` render the
sidebar once more than allowed; `unlock again` renders `Messenger` once more; `send while disconnected, then reconnect`
touches `Messenger` and `Sidebar`; and the `reset device` step records no commits at all, which is a defect in the step
itself rather than a budget. Either the MLS bookkeeping moves off the conversation record or the budgets are re-cut with
the reason recorded. That belongs to the Increment 10 hardening gate and has not been done.

### Next

1. Decide the render-audit question above.
2. Relay opaque events through any connected member, so a non-owner member reaches members it has no transport to.
3. Distribute the roster with a membership commit: a member that applies an add still cannot name the new member,
   because the commit carries no locator.
4. Transport orchestrator over all roster locators; member numbers preserved across leaf moves.
5. Remaining Increment 8 items: proposal queue, bounded epoch retention, fork quarantine with an owner-selected
   `ForkResolution`, stale-tab fencing token, IndexedDB lease fallback.

## 2026-08-10 — Manual test found the transport/conversation collision; D-011 accepted

The manual three-participant test failed with `MLS checkpoint member number does not match the conversation roster`,
thrown by the worker's `load` when the invite asked to initialize member 2 over a checkpoint that already said member 0
or 1. The invitee already had a one-to-one chat with the inviter: the log shows conversations `0` and `1` restored at
unlock and the incoming dial reported as a re-open of an existing connection. `ephemon.get(publicKey)` keeps exactly one
transport per peer, and that transport's handlers belonged to one conversation, so the group invite landed inside the
existing direct conversation and collided with its MLS group. On the inviting side the same reuse re-pointed the
handlers of his direct chat with that contact.

D-011 records the accepted shape: a group is its own conversation, created explicitly from known contacts, and there is
no add-member on a one-to-one chat. One transport therefore carries several conversations, dispatched by `routingId`.

### Implementation order

1. Routing table `routingId -> conversation`, populated from stored `mlsBootstrap`, bootstrap completion, invite join
   and group creation. A frame with a known `routingId` is dispatched to that conversation; `hello` and self-chat bytes
   fall back to the peer's direct conversation.
2. Transport-level binding: state, progress, transport-change, error and close fan out to every conversation that uses
   the transport, instead of the last conversation that bound it.
3. An `invite` frame with an unknown `routingId` creates a group conversation (`kind: 'group'`, empty `publicKey`,
   roster in `mlsBootstrap`) rather than joining the peer's direct conversation. Invite sessions are keyed by
   conversation, the owner's also by invitee locator.
4. Group-aware send and clear: a group has no single `connectionsRef` entry, so usability comes from having any usable
   transport and readiness from the MLS state.
5. UI: create a group by picking known contacts, add a member the same way, and offer add-member only inside a group.
6. Rewrite `tests/group-chat.spec.ts` for that flow, where the third participant is already a contact -- which is the
   case that just failed.

## 2026-08-10 — Groups are their own conversations and the transport is shared

`tests/group-chat.spec.ts` now covers the case the manual test broke on: Bob and Carol are ordinary contacts with their
own direct MLS chats first, Alice then creates a group from those contacts, both of them join, each member's own message
reaches the owner, the owner's message reaches both, and Alice's direct chat with Bob still carries its own messages and
does not show the group's. Green.

### What changed

- One transport, many conversations. A frame is dispatched by its `routingId` through a routing table populated from the
  stored bootstrap, from bootstrap completion, from an invite join and from group creation. `hello` and self-chat bytes
  fall back to the peer's direct conversation, and an `invite` naming an unknown group opens a group conversation
  instead of landing in the direct one.
- Transport events fan out. State, progress, transport change, error and close reach every conversation that uses the
  transport, so a group hears the link it shares with a direct chat.
- A group conversation has `kind: 'group'` and no `publicKey`; its members are the roster in `mlsBootstrap`, and its
  transports are re-created from that roster on unlock. Sending in a group needs any usable transport rather than one
  primary connection, and anti-entropy now derives its author set from the whole roster instead of a pair.
- Invite sessions are keyed by conversation, the owner's also by invitee locator, so the same contact can be invited to
  more than one group. Staged adds run through a per-conversation queue, because MLS refuses a second staged commit
  before the first is merged.
- The creator opens a group alone at epoch 0 and every member arrives through the ordinary invite exchange.
- UI per D-011: "New group" in the sidebar picks known contacts, add-member uses the same picker and appears only inside
  a group, and the contact-code input is gone. `AddMemberModal` is deleted.

### The defect that hid behind the rest

`addConversationMember` called `connection.open()` unconditionally. For a contact whose direct chat already had an open
link, that re-opened an established transport: the invite handshake died mid-exchange, both sides logged "Connection is
not ready yet", and the signaling server was left re-dialling. A transport that is already open is now only invited
over.

### Verification

- 20 Playwright specs pass, including the rewritten group spec, `clear-history`, `single-writer`, `reply`,
  `offline-compose`, `delete-chat` and `self-chat`.
- Core suite 40 files / 417 tests; Chromium MLS harness; `prettier --check` clean.
- Render audit: no new render cost from the group work (`clear history` 13 renders, `delete chat` 13); the same seven
  pre-existing budget overshoots remain, plus one flaky dial timeout from the local signaling server that passed on
  re-run.
- `git diff --check` reports the trailing double spaces in `mls-decisions.md`, which is that file's existing committed
  Markdown line-break convention.

### Known residue in the group flow

Two guards rejected traffic without breaking the run, and both deserve a follow-up rather than a shrug: a member that
joined by Welcome rejected a commit with `WrongEpoch`, since the invites are issued back to back and a commit can arrive
for an epoch the Welcome already carried; and the owner rejected one application message with `TooDistantInThePast`,
which is a re-served ciphertext arriving twice. Neither corrupts state.

### Next

1. Relay opaque events through any connected member, so a member reaches members it has no transport to. Today Bob and
   Carol only reach each other through Alice, and nothing forwards.
2. Distribute the roster with a membership commit: a member that applies an add cannot name the new member, because the
   commit carries no locator, so it cannot open a transport to it.
3. Suppress the two rejections above: a commit already covered by a Welcome should be ignored, and a re-served event
   should be recognised before it is decrypted.
4. Decide the render-audit budgets question recorded in the previous entry.

## 2026-08-10 — What the manual group test broke, and the fixes

The manual run produced three separate faults, all now covered by `tests/group-chat.spec.ts`, which was rewritten to
follow that exact sequence: two contacts first, then a group built from them, then a message sent the moment the group
exists.

**The group chat tried to dial an empty locator.** A group has no single peer, so its `publicKey` is empty; the connect
and "try again" paths still went through `ephemon.get(conversation.publicKey)` and the signaling server answered
`Public peer key cannot be empty`. Opening a group now opens the transports its roster names, and deleting a group no
longer closes a transport the direct chats share.

**The peers' group row was blank.** Only the creator had a name, because the invitee created its conversation from the
routing id alone. Each side now names a group after the members it knows, from the roster in the invite and again on
every roster change, so no name travels the wire and no row is anonymous.

**The second member overwrote the first.** `addConversationMember` snapshotted the roster and the next member number
when it was called, and `createGroup` invited both members without waiting, so the second invite was staged against a
roster that still lacked the first member: the persisted roster lost a member and both invitees would have been recorded
under the same number. Adds are now strictly sequential per conversation, and a group send waits for its own outstanding
invites before authoring, because an invitee cannot read a ciphertext made before it joined.

One more fault surfaced while fixing those: a joining member opened transports to every locator in the roster, so a
member dialled a stranger, and the stranger's client answered by opening a chat of its own and focusing it. A group now
only uses transports to peers this device already knows; dialling unknown members is the transport-orchestrator step.

Separately, the update prompt the manual run kept showing was the service worker's own doing: its `install` handler
broadcast `NEW_VERSION_AVAILABLE` to every window client, `includeUncontrolled: true` included, so a tab was told about
the very worker its own first load had installed. It now notifies only on a replacement (`registration.active` is
non-null) and only clients an older worker still controls.

### Verification

- All 20 functional Playwright specs pass, including the rewritten group spec and every direct-chat spec.
- Core suite 40 files / 417 tests; Chromium MLS harness; `prettier --check` clean.
- Render audit still fails exactly the seven pre-existing budgets (`clear history` 13 renders against 12, sidebar and
  `Messenger` re-renders on connect, reconnect, unlock and offline-send) and nothing new.

### Still missing for a real group

1. A member reaches only the peers it already knew: no relay of opaque events through a connected member, so two members
   that never met talk only while the owner is online, and a group name lists only the members that side can name.
2. A membership commit carries no locator, so a member that applies an add cannot name or reach the new member.
3. Two guards still reject traffic without breaking anything: a commit already covered by a Welcome (`WrongEpoch`) and a
   re-served ciphertext (`TooDistantInThePast`).

## 2026-08-10 — Group identities: a member announces its name and its locator

D-012 and D-013 were accepted, and the first of the five agreed items is done and green in `tests/group-chat.spec.ts`:
the creator names itself in the create-group dialog, an invited member is asked for a name the first time it opens the
group and cannot type until it has one, and the kebab offers "Change my name in group".

`member.profile` is an ephemeral application event carrying the author's chosen name and its own locator. Ephemeral, not
durable, because the name is soft state: it lives in the conversation's roster and is re-announced whenever a group
transport opens, when a member joins, when the owner sees a new member join, and on every rename. That keeps it out of
the durable log, so no chain position, no frontier entry and no migration. The roster gained a `name` per member, so a
group is now named after the names its members announced and falls back to their locators.

The locator in the announcement is what closes the gap recorded earlier: a member that applies a membership commit can
now name and reach the member that commit added, without the commit carrying anything but MLS.

### Verification

- `tests/group-chat.spec.ts` covers the whole flow: two contacts, a group built from them, names set on all three sides,
  each side's row showing the others' announced names, the owner's first message reaching both members, both members'
  messages reaching the owner, and the direct chat with one member still carrying its own traffic.
- All 20 functional specs pass; core suite 40 files / 417 tests; `prettier --check` clean.

### Next, in the agreed order

2. Author above each message in a group, and a click on the author opening the standard QR and contact-code modal.
3. The `relay` frame from D-012: forward to every transport except the source, drop by payload hash, hop limit; plus
   anti-entropy between any two members.
4. The incoming-dial modal with accept, decline once and decline forever; the encrypted blocklist store; the sidebar's
   Blocked list with unblock behind a confirmation.
5. The two remaining guard rejections: a commit already covered by a Welcome, and a re-served ciphertext.

## 2026-08-10 — Items 2 to 5: authorship, the flood, the dial modal and the two rejections

All five agreed items are done. Two new specs carry them: the group spec grew the authorship, relay and naming
assertions, and `tests/blocked.spec.ts` covers the dial modal and the blocklist.

**Authorship.** A peer bubble in a group carries the author's announced name above the text, resolved from the roster by
the member number the MLS sender check produced, and falling back to the member's locator. Clicking it opens the same QR
and contact-code modal a contact's kebab does, so a member met inside a group can be added as a contact.

**The flood.** A `relay` frame carries an unmodified ciphertext. On arrival, direct or relayed, a payload's SHA-256 is
checked against a bounded per-conversation seen set: a repeat is dropped and never forwarded, and a first sighting is
processed and forwarded to every transport of that conversation except the one it came from, with the hop counter
decremented. Own ciphertext is marked seen when it is sent, so a member echoing it back cannot make this side treat it
as new. The spec now asserts what the manual test found broken: Bob and Carol, who never met, see each other's messages
through the owner, with the author line naming the writer.

Two rules had to change for that to be true. The roster is no longer consulted to decide whether an author is a member,
because MLS already decided it, and the roster is incomplete by design on a member that only saw a commit; and a profile
announcement from a member number the roster has never seen now adds that member instead of being refused. Together they
are how a member learns about a member somebody else's commit added.

**The dial modal.** `window.confirm` is gone. A stranger's dial opens a modal with accept, decline once and decline
forever; declining forever writes the locator into the encrypted `blocked` store, which migration `003_blocked` adds,
and every later dial from it is refused before any saga starts. The sidebar has a Blocked button next to New group; the
list unblocks behind a second tap. The blocklist survives a restart, which the spec checks by reloading and unlocking
again.

**The two rejections.** A commit that does not apply to the current epoch -- one the Welcome already carried -- is now
ignored with a debug line instead of raising, and a ciphertext that cannot be decrypted, a duplicate or an event this
side can never read, is dropped the same way. The suite log no longer contains either error.

### Verification

- 21 functional Playwright specs pass, including `group-chat` and the new `blocked`.
- Core suite 40 files / 417 tests; Chromium MLS harness; `prettier --check` clean.
- Render audit still fails only its pre-existing budgets: `clear history` renders and its sidebar touch, the sidebar on
  connect and reconnect, `Messenger` on unlock, and the offline-send step, which now also re-renders `ChatPane` because
  a group-aware pane takes the roster as a prop.

### Next

1. Re-cut or re-earn the render-audit budgets; that gate is the only red one left.
2. A group still only reaches members this device knows: dialling roster locators announced by `member.profile` would
   make the mesh complete, and the flood already covers what a partial mesh cannot.
3. Group history for a member that joined later, which needs the bounded epoch retention from the plan's §4.4.

## 2026-08-11 — Tests first for per-author attribution, and the offline group message

`tests/group-mesh.spec.ts` is the scenario asked for: three clean devices, the master adds both peers, builds a group
from them, everyone writes once, everyone replies to both others, everyone reacts to both others, and then each member
restarts in turn and writes again. Everything up to the restarts passes, including the two peers that never met seeing
each other through the owner, and every reply landing with its quote on all three sides.

Three defects were found and fixed while building it: a group did not restore its MLS state after a reload, so sending
silently produced nothing; an event that arrived before the commit that opens its epoch was rejected instead of waiting,
and is now queued and replayed once that commit applies; and the test's own bubble locator matched the quoted text
inside a reply, which sent reactions to the wrong message.

What still fails, and it is a real gap rather than a test artifact: a group message authored while the transports are
down is shown locally but never reaches the other members after the link comes back. The inventory exchange happens on
reconnect, so the missing piece is on the serving side of anti-entropy for a group.

`tests/group-attribution.spec.ts` is written ahead of the implementation, as asked, and fixes the contract from D-014:
one chip per distinct emoji with the number of members behind it and their names in the title, re-reacting with the same
emoji removing only that member's reaction, and a message reading as seen only once every other member has seen it.

### Next

1. Serve a group event authored offline: the anti-entropy reply has to include it, which is what the mesh spec's last
   block is waiting for.
2. Implement D-014: receipts keyed by target and author in the record model, aggregation in the chat store, chips and
   receipt titles in the bubble. `group-attribution.spec.ts` is the acceptance test.

### Offline group delivery: what has been ruled out

The reconnecting side now restores its group state from the vault when a transport opens and then sends its profile and
its inventory, because the peers' own links never dropped and they have no state change to answer with. The message
authored while the link was down still does not arrive, so the remaining suspects are, in order: whether the peer
answers that inventory with its own (the `reply` flag path), whether `serveInventory` filters the record out -- the
live-epoch condition compares the record's epoch against `ownCommitHead`, and an event authored offline is stamped from
the restored `inspect` epoch -- and whether the frontier clamp counts the offline event as authored. The next step is a
single instrumented run logging, on both sides, the inventory frames exchanged and what `missingForPeer` returns.

## 2026-08-11 — Offline group delivery: cause found, two fixes landed, one gap left

Instrumenting the inventory exchange settled it. Two real defects were fixed:

- `serveInventory` refused to re-serve any event whose epoch was not the live one. That condition was wrong from the
  start: re-serving encrypts the stored plaintext again in the current epoch, so the epoch an event was written in says
  nothing about whether it can be sent now. Only the member's own join epoch may exclude an event, and that check stays.
- A group dialled its members one at a time and let the first failure abort the rest. They are dialled together now, and
  a refusal is logged per member instead of deciding for the others.

What the trace showed after that, and what is still open: when a member reloads and reconnects, only one of its two
member links reaches `open` in that window, so its message reaches one member instead of both. The serve itself is
correct -- `wanted` names the missing sequence and the event is sent -- but it goes to a single transport. The next step
is on the transport side, not the protocol: find why the second dial in that window does not complete, with the core's
saga log for both dials side by side.

State of the three group specs: `group-chat` passes; `group-mesh` passes everything except the last block, the restart
that waits for both members; `group-attribution` fails by design, since D-014 is not implemented yet.

## 2026-08-11 — The restart gap is epoch drift, not transport

Two more fixes landed. A group's connection state is now the aggregate of its member links -- one open link no longer
reports the group as connected -- and members are dialled together rather than one after another. Neither made the last
block of `group-mesh` pass, and un-silencing the drop path showed why, in the peers' own words:

```
[peer1] Conversation 1 deferred an event from an epoch it has not reached.
[peer2] Conversation 1 dropped an application message it cannot decrypt.
[master] Conversation 2 dropped an application message it cannot decrypt.
```

So the members are not in the same epoch: one defers everything as "from the future", the others cannot decrypt what
arrives, and a re-served event is re-encrypted in an epoch its reader does not hold. Generation reuse after a restart
was ruled out: `MlsWorkerClient.mutate` awaits the checkpoint write before returning a ciphertext and rolls the worker
back if that write fails, so a restored session cannot re-use a generation that has already left this device.

That makes the remaining work epoch reconciliation rather than transport: a member that missed the commit which moved
the group forward has to be given it, and `serveCommits` only offers commits when the inventory it answers carries a
head. The next step is to check what head each side puts in its inventory after a restart, since a missing head means
`serveCommits` returns early and the member stays behind forever, deferring everything that follows.

Also of note for whoever picks this up: the drop and defer paths added earlier hide exactly this class of fault. They
should keep a counter or a rate-limited warning rather than a debug line, so a member falling behind is visible without
instrumenting a test run.

### The owner now logs its own commits, and one class of drift is gone

`addConversationMember` records the commit it authored in the commit log, with the head from before the add as its
parent. Until now only a member applying somebody else's commit wrote to that log, so an owner had nothing to serve, and
a member that missed the add-commit could never be caught up. The effect is visible immediately: the member that used to
defer everything now reports `advanced to epoch 2 by member 0` during the reconnect and starts reading again.

What is left of the restart gap is narrower and clearer: after a restart, this side and the member that joined last drop
each other's events as undecryptable while the first member reads fine. Both sides retain past-epoch secrets, so a
member can run a whole conversation at a stale epoch and still look healthy, which is what hid this until the mesh spec
put three members and a restart in the same run. The direction that follows from D-012: an inventory exchange must
reconcile heads before it serves events, and a decrypt failure should ask for the missing commits instead of being
dropped -- the drop path exists to swallow duplicates, not epoch drift, and it currently swallows both.

### Generation reuse after a restart, and the owner's rekey

The epochs were never the problem: instrumenting both sides showed the failures happening at the same epoch on both, so
`UnableToDecrypt` there means the sender reused a generation its readers had already consumed and forgotten. A restored
session continues its send ratchet from the vault, and a reader that consumed a later generation -- a relayed or
re-served ciphertext that arrived after the reload -- refuses everything that follows.

The remedy that fits MLS is to rekey, and only a commit does that. The owner now issues a self-update while restoring
its group: the epoch moves, every ratchet is fresh, the commit is written to the log and pushed as soon as one of the
group's transports opens, and a member that missed it is served it from the log. The trace confirms the mechanism -- the
group moves to epoch 3 and the other member follows it there.

Two things remain. The owner's own restart still does not deliver the message it authored while offline, even though the
rekey lands and the epochs agree afterwards; the re-serve happens three times in that window, so the next step is to
follow one of those ciphertexts end to end rather than to reason about it. And a member that is not the owner cannot
rekey itself under OwnerOnly: since any commit resets every ratchet, the owner can do it on the member's behalf, and the
signal for that is already on the wire -- a member re-announces its profile when it re-enters, which is exactly what a
restart looks like from the outside.

## 2026-08-11 — Group chat is manually acceptable; D-014 is half in

The whole group scenario is green: `tests/group-mesh.spec.ts` (three clean devices, both peers added as contacts, a
group built from them, a message each, replies to both others, reactions, and each member restarting in turn and having
its offline message delivered) and `tests/group-chat.spec.ts` both pass, with 22 of 23 functional specs green. What made
the restart case work, in the order the faults were found: the owner records its own commits so a member that missed one
is served it; a decrypt failure asks the group for a catch-up instead of being swallowed; the owner rekeys with a
self-update while restoring **and merges it** -- without the merge it sat on the old epoch while everybody else moved
on, which was the root cause; a re-dialled peer is replaced in every conversation that rides it, not only in the direct
chat that owns it, because a group was holding a closed transport object; the group's state is the aggregate of its
member links; and members are dialled together.

D-014 is implemented up to the aggregation: receipts and reactions are kept per member in the chat store, merges keep
both sides' members, the bubble renders one chip per emoji with the member count and the names in its title, and the
receipt opens a modal listing every member as read, received or waiting. `tests/group-attribution.spec.ts` still fails
on the very first aggregate assertion: two members reacting with the same emoji produce a chip that counts one. The chip
itself is right, so the next step is to log the reaction records the receiving side accepts and see whether the second
member's event arrives at all -- everything downstream of that point is already in place.

### Per-author reactions: the aggregate is right, the bubble still shows the old value

Two faults were behind the chip counting one member. The picker decided the toggle from the message's reaction rather
than from this member's own, so a second member choosing the emoji another had already chosen sent an empty value, which
reads as "take mine back": tapping the same emoji now only takes back the reaction of the member doing the tapping, and
the store proves it -- all three sides log `[["👍",[1,2]]]` for the same message.

What is left is only the rendering: with the aggregate holding two members, the chip still shows the bare emoji, which
is the legacy single-reaction value. The chip markup takes its text from `reactions`, and the fallback to
`message.reaction` is what produces exactly this output, so the message object reaching the bubble has `reaction` set
and `reactions` empty. The suspect is the persistence round-trip: `hydrate` rebuilds messages from stored records, and a
path that replaces rather than merges would keep the legacy field and drop the aggregate. That is where to look next;
everything upstream of it is verified by the log above.

## 2026-08-11 — D-014 done: reactions and receipts belong to their member

`tests/group-attribution.spec.ts` passes, and with it 23 of 24 specs; the only red left is the render audit on its
pre-existing budgets.

Three faults stood between the model and the screen. The picker decided its toggle from the message's reaction instead
of this member's own, so a second member choosing an emoji another had already chosen sent an empty value, which means
"take mine back". `sameMessage` compared only the legacy single reaction, so a second member's identical emoji looked
like no change and the recomputed aggregate was dropped before anything rendered. And the chip was positioned
absolutely, as the single badge always had been, so two chips stacked on top of each other and the covered one could not
be clicked -- they are laid out in a row now.

What a group shows today: one chip per distinct emoji with the number of members behind it and their names in its title,
tapping the same emoji again taking back only that member's reaction, and the receipt opening a list of every member as
read, received or waiting. The list is what answers "who has it"; the check mark stayed as the short form.

Two things the specs had to learn rather than work around, because they are honest app behaviour: reading is decided by
the viewport, so a side scrolled away from a message does not report it as read; and the repair after a restart --
reconnect, rekey, inventories, re-serve -- is several round trips, so those assertions carry their own budget instead of
the one-hop default.

## 2026-08-11 — Manual acceptance found what the specs did not

Five defects and three unfinished decisions came out of a manual run. The specs missed them because they name every
member early, keep every side scrolled to the same place and assert per side rather than comparing sides against each
other. Each item below says what to check first.

**Defects.**

1. The group's name differs per member: one peer sees only the owner's name, the other the owner's name and the second
   peer's locator. So a member's roster is incomplete or nameless, and `groupNameFor` falls back to the locator. Check
   whether a profile announcement reaches a member that has no transport to its author -- the flood should carry it --
   and whether the name is recomputed when it does.
2. The message-status list shows locators instead of names, which is the same missing-name root as the first item.
3. One member's read receipts never reach the others: the other two see `received` from it and `read` from each other.
   Check whether that member authors seen receipts at all, and whether they leave its device.
4. A member can react to its own message, which was not possible before: my own regression, reverted with this entry --
   an own chip no longer opens the picker, and the helper and assertion that used it are gone.
5. After a restart and a resync, already-received messages raise notifications again on every side. `displayRecord`
   notifies for any peer record it has not notified about in this session, and the set is empty after a reload, so a
   re-served event looks new. Seed it from the hydrated history, or refuse to notify for anything older than the
   session.

**Decisions to finish.**

1. Who left which reaction is not visible anywhere.
2. With many members the reaction row overflows. It should be one bubble cycling smoothly through the grouped reactions
   -- `👍 2`, then `🔥`, then `💜` -- and the members behind them should be readable only on one's own message, by
   clicking that bubble.
3. The picker does not mark the emoji this member already chose.

### Two of the manual findings are fixed, one flake is still chasing the restart repair

Reacting to one's own message is impossible again, the emoji this member already chose is marked in the picker, and a
resync no longer raises notifications for events written before the session opened -- a re-served message is not news.
22 of 23 specs pass with those in.

The one red is `group-chat`, and only inside a full run: after the owner restarts and rekeys, the other member's next
message reaches it within a minute when the spec runs alone and sometimes not when the machine is loaded. The path it
depends on is the one to watch: that member never saw a state change of its own, so it sends at the epoch it still
holds, and it only learns the new one when its inventory crosses with the owner's. Making the rekeying side push its
commit to every member as soon as it has a live transport -- rather than relying on the exchange that follows -- is the
fix to try before touching timings again.

## 2026-08-11 — The restart repair was losing events, not running slowly

A diagnostic run answered the question directly: the reconnecting owner sent its message to two live transports and
neither member ever accepted it. So it was lost, not late. The cause was ordering, and the sleeps were hiding it. A
member cannot read anything written in the epoch a rekey opens until it holds that rekey, so the commit has to leave
before the first ciphertext of that epoch. It is now sent from inside the rekey itself, to every transport that is up,
and the promise a group send waits on covers that send -- so a message can only be authored after the commit is on the
wire.

Three things went with it. The repair became a push: when a link comes up, the side that just came back sends its own
recent events together with the commit and its inventory, instead of waiting to be asked. The two artificial pauses (one
and four seconds) are gone, and so is every other sleep in the hook -- `grep setTimeout` over `useEphemon.ts` returns
nothing; what replaced them is the event that actually means "that member re-entered": its profile announcement, which
the receiver answers with an inventory. And the catch-up throttle came down from two seconds to half a second, because
it is a throttle, not a wait.

The effect on the specs is the point: the minute-long budgets are deleted, the group specs pass on the default per-step
timeout, and the three-restart mesh scenario runs in about a minute and a half.

```
24 specs: 23 passed, 1 failed (render audit, on its pre-existing budgets)
core suite 417 tests, prettier --check clean
```

### Names converge on every side

The first two manual findings had one cause: a profile announcement is ephemeral, so a member that was not reachable
when another announced itself never heard it, and the name fell back to a locator -- in the group's row and in the
message status list alike. Hearing from a member for the first time is now the moment to introduce oneself back, so a
join or an announcement starts a fresh round and everyone ends up named. No timers involved; the trigger is the
announcement itself.

The mesh spec was the reason this slipped through: it only checked the owner's row. It now asserts that every side names
every other member, and it passes.

Left from the manual list: one member's read receipts not reaching the others -- worth checking against what the
attribution spec learned, that reading is decided by the viewport, before assuming it is a protocol fault; the single
reaction bubble cycling through the grouped reactions instead of a row that overflows; and the authors behind those
reactions being readable on one's own message.

### A read receipt is the member's own statement

The third manual finding was the aggregate turning against itself: once receipts are kept per member, the legacy `seen`
field is filled by whoever read the message first, and both the bubble's visibility guard and the send path read that
field -- so every member after the first concluded the receipt had already been sent and never authored its own. The
guard now ignores the aggregate, and the send is skipped only when this member's own entry is already there.

The attribution spec grew the assertion that would have caught it: a member opens the status list of its **own** message
and finds the other two marked as having read it, rather than only the owner checking its own.

### Reactions: one bubble in turn, and who left which one

A row of chips overflows as soon as a group is large, so a message now carries a single bubble that shows each grouped
reaction in turn -- `👍 2`, then `🔥`, then `💜` -- with a short fade between them. The timer behind it is a
presentation concern and lives in the bubble, not in the protocol: nothing waits on it.

Who left which reaction is answered where the sender already asks who has the message: on one's own message, clicking
the reaction opens the status list, and each member's row carries its emoji next to read, received or waiting. On
somebody else's message the bubble still opens the picker, which now marks the emoji this member already chose.

```
23 functional specs passed, core suite 417 tests, prettier --check clean
```

Everything from the manual list is in except the render audit's pre-existing budgets, which is the one red left in the
whole suite.

## 2026-08-11 — The author travels in the event, and the reconnect path became one machine

**The author is now part of the canonical envelope.** Re-serving re-encrypts, so the MLS sender of a re-served event is
whoever passed it on, and attribution taken from there is simply wrong -- that is why, after a member reconnected,
messages from two different people appeared under one name. A durable event carries its author next to its chain
position, the receiving side attributes from the envelope, and the MLS sender is kept for what it actually proves: the
frame came from a member of this group. Event identifiers changed with the envelope, which is why the database was
wiped. The Chromium harness fixtures were updated with it; harness, 23 functional specs and the core suite all pass with
the author in place.

**The reconnect path is one entry point.** Three independent triggers -- a link coming up, a profile announcement, a
decrypt failure -- used to each run their own sequence, which is what made the same step pass and fail on alternate
runs. There is now a single `reconcile(id)`, serialised per conversation, that restores the group state, rekeys if this
side owns the group, pushes the rekey commit, announces itself, pushes what it owes and asks for what it lacks, in that
order. The throttle stays where it belongs -- on the ask that follows a decrypt failure -- because a throttle inside the
machine drops the link that came up second.

State: `group-mesh` passes with the machine, `group-chat` does not -- its owner restarts, reconnects and only then
sends, and that ordering exposes a race between the machine's first step and the send path, which awaits the rekey
rather than the machine. The fix to try is to let a send wait on the machine itself instead of on the rekey promise, so
authoring can only happen after the group has converged; that is one dependency, not another trigger.

### The machine is green

A group send now waits on `reconcile` before it waits on anything else, so a message can only be authored after the
group has converged -- state restored, epoch settled, commit on the wire. That was the last race: the send used to wait
on the rekey alone, which says nothing about whether the members have been told about it.

```
23 functional specs passed; core suite 417 tests; Chromium MLS harness ok; prettier --check clean
```

The only red left in the repository is the render audit, on the budgets it had before any of this work.

### 1-1 receipts: what the new spec proves, and what it does not

`tests/receipts.spec.ts` states the semantics the manual run questioned: with the recipient scrolled away from the
conversation, the sender's message is marked delivered and **not** read, and it becomes read the moment the recipient
scrolls to it. It passes, so the delivered receipt does not depend on the recipient looking, and the read receipt does
-- which is the intended pair.

What it cannot reproduce is the reported case, and that is worth writing down rather than smoothing over. The first
version of the spec put the recipient's window behind the sender's with `bringToFront`, and the recipient still reported
the message as read immediately: a page that is merely behind another window stays visible to the DOM. In a real
background window Chrome throttles the tab, and then nothing of the recipient's pipeline runs -- neither the delivered
receipt nor the read one -- which is exactly what was seen: no mark at all until the window was focused, and then both
at once, so the sender jumped straight to read. That is a throttled-tab problem, not a receipt-logic one, and the honest
answer to it lives on the push and service-worker path rather than in the chat hook.

### The read receipt reports once per member, and the spec now proves it deterministically

The manual report was right and the cause was mine: the bubble's "already reported" flag had been keyed on whether
anybody's receipt existed, so as soon as one member's read entry appeared the flag started false again and the bubble
re-reported on every mount -- which is why switching windows turned a message read instantly. It is keyed on this
member's own entry now, so a remount reports nothing.

The first version of the spec was not a proof of anything: it kept the recipient scrolled up, and a new message pulls
the list to the bottom by design, so the recipient really did see it. "Not looking" is expressed properly now -- the
recipient sits in another conversation -- and the pair holds: delivered without the recipient looking, read only once
the conversation is opened and the message is on screen.

```
24 functional specs passed; core suite 417 tests; prettier --check clean
```

## Catching a member up cannot be something it asks for

The reported defect was a member permanently logging `deferred an event from an epoch it has not reached` and seeing
nothing new again. The cause is structural, not a slip: a catch-up request travelled as an _application_ event, so it
was encrypted in the epoch the asking member was stuck on, and every member ahead of it failed to decrypt exactly the
message that would have told them what to send. Both sides then repaired in the only way they knew -- by asking again,
each in an epoch the other could not read. A member one commit behind was rescued by the owner's rekey push on
reconnect; a member two commits behind was not, because that push carries one commit and MLS rejects it as `WrongEpoch`.

Commits now go out as a pushed tail rather than a request: `serveCommitTail` sends the last `COMMIT_TAIL` recorded
commits, in epoch order, as plaintext `commit` frames on every reconcile, and whoever already holds one drops it. That
makes "a commit this side cannot apply" the normal case, so `applyCommitOrDrop` no longer treats anything but
`WrongEpoch` as fatal -- a commit from before this member joined is not an error either. Applying is serialised through
the existing `runExclusiveCommit`, because a tail arrives as several frames at once and MLS applies them in the order
they were written. An advance now also updates the ready state's epoch, reopens the catch-up window it had spent while
it was behind, and asks once from the epoch it just reached.

`tests/group-epoch-catchup.spec.ts` pins it: the owner restarts twice while a member is out of the app, so the member
returns two commits behind, and the message written while it was away has to arrive anyway -- then what it writes has to
reach the group. Verified red before the change (`toHaveCount` on the missing bubble) and green after.

## The client that announces itself has to reach the worker holding its pushes

The second reported defect -- a dial not delivered to a master that had just unlocked after a push -- is the same class
of mistake one layer down. A stored push is replayed when the client posts `CLIENT_READY`, and that message went to
`navigator.serviceWorker.controller`. After a worker replaces another with `skipWaiting()` and no `clients.claim()`, the
already-loaded page is still controlled by the worker it replaced: the announcement went to a redundant worker and was
dropped, while the pushes sat in the database of the active one. Every reload during this work installed a new worker,
which is why it started showing up now.

The worker claims its clients on activation, and the announcement goes to `registration.active` before falling back to
the controller. Covered in `packages/ephemon-core/__tests__/ephemon.test.ts` by a case where the controller is the
worker that was replaced.

The app's core also starts exactly once now. `hasEphemonCore()` only becomes true when the asynchronous initialise
resolves, so a re-render in between started a second one -- the `Parallel initialization attempt` line in the reported
log -- and the second attempt's config, handlers and update interval were built and thrown away.

## 2026-08-22 — Manual acceptance: the group name, the unread count, and the dial that needs attention

Four reports, three of them mine.

**The group name diverged because an unnamed member was still an entry.** D-013 says a member without a name is not part
of the name, and `groupNameFor` did not honour it: it fell back to `displayName(...)`, which renders a locator. The
creator's own name reaches everyone through its profile event, so the side that joined first saw only that name while
the side that joined with a fuller roster saw the name plus somebody's raw key. The gate is applied now -- a contact's
local name still counts, a locator never does -- and a group where nobody is named yet reads `Group` instead of a row
with an empty name.

**The unread count answered for the wrong member.** `applyReceipt` fills `seen` from whatever member's receipt lands,
which is what a sender's bubble needs in a group, and the unread count was reading the same field: another member
opening the group cleared everybody's badge. The count is per member now -- an entry of one's own in `seenBy`, with
`seen` still the answer for a conversation that has no member number.

**A dial that arrives while the tab is in the background asks for attention.** The notification goes out when the modal
opens on a hidden or unfocused tab; a dial from a known contact needs no attention because it completes on its own.
`showNotification` in the core now addresses the active worker like the readiness announcement does.

`Decline forever` is filled with the accent already used for destructive actions.

`tests/group-unread.spec.ts` covers the first two: every side reads the same name right after creation, and a member
that never opened the group still counts the message as unread after another member has read it -- asserted after a
reload, so the count comes from the vault rather than from a race. `tests/incoming-dial.spec.ts` covers the other two.
Each assertion was verified red against the code it fixes.

```
27 functional specs passed; core suite 418 tests; prettier --check clean
```

## 2026-08-22 — Introducing yourself is a gate, not a dialog

A closable dialog was the wrong shape for it. Dismissing it left the member reading a group it had not joined: the
composer was disabled but looked ordinary, receipts went out for messages it was reading, and the name it had typed into
the dialog was sometimes dropped on the floor.

The form replaces the conversation now. A group whose own roster entry carries no name renders `IntroduceSlot` where the
message list and the whole footer would be, so there is nothing to dismiss, nothing to read, and no bubble to mount --
which is what keeps the read receipts from going out and the unread count standing. Leaving for another conversation and
coming back shows the form again, because it is derived from the roster rather than from a dialog that was shown once.
The header stays, so the kebab and the mobile back button still work, and renaming yourself later is still the dialog it
always was.

Two things behind it needed fixing. `setGroupMemberName` did nothing at all when the conversation had no live MLS
session -- exactly the case of a member that reloaded and went straight to the group -- so the name is now written to
the stored roster and announced by the reconcile that follows, and the dialog no longer reported success for work it had
not done. And a disabled composer now looks disabled: the send button is disabled with the input, and
`composer--disabled` dims them both, which is what an observer tab shows too.

`tests/group-introduce.spec.ts` states the gate: the form instead of the conversation, no bubbles, the sender's message
delivered but never seen, the form again after coming back, and everything open once the name is given.
`tests/group-unread.spec.ts` covers the name that used to be dropped, and `tests/single-writer.spec.ts` covers the
observer's composer looking the way it behaves.

```
28 functional specs passed; core suite 418 tests; prettier --check clean
```
