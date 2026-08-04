# MLS everywhere: incremental implementation plan

Status: Increments 0–5 implemented; Increment 6 is next  
Created: 2026-08-03  
Reviewed: 2026-08-04  
Scope of the first phase: two-member conversations only; the design must scale to real groups without replacing the
primitives introduced here.

Implementation progress and immediate next steps are maintained in [`mls-working-log.md`](./mls-working-log.md).
Accepted product and protocol choices are maintained in [`mls-decisions.md`](./mls-decisions.md).

## 1. Goal

Move every application message to MLS while keeping the current Ephemon connection as the transport layer.

The first delivered version will model every private chat as an MLS group of two members. Once that path is stable under
disconnects, reconnects, duplicated delivery, saga failover and local crashes, the same conversation and replication
primitives will be extended to groups with more than two members.

The following parts of the current protocol remain unchanged:

- signaling server request types and JSON contracts (`update`, `dial`, `offer`, `answer`, `ice`, `close`);
- signed and time-limited signaling;
- ephemeral connection encryption used to protect SDP, ICE and the established data channel;
- two connection sagas (`incoming` and `outgoing`) and their negotiation state machines;
- prime and guest SignalR connections, including cross-server connection establishment;
- STUN/TURN behavior.

The established data channel changes from text messages to opaque binary frames. All MLS objects, including KeyPackages,
Welcome, Proposal, Commit and PrivateMessage, travel only through an already established Ephemon connection.

## 2. Decisions proposed for review

These decisions are intentionally explicit because changing them later would change persistence or wire formats.

1. **MLS lives above `Connection`, never inside a saga.** One conversation owns one MLS state. Both sagas feed the same
   serialized inbox, and `Connection` may resend an identical frame over the surviving saga.
2. **The current outer connection encryption stays.** MLS wire bytes are wrapped in the existing per-saga Secretbox and
   WebRTC DTLS. DTLS already protects data from TURN/network intermediaries; Secretbox preserves Ephemon's independent
   link-encryption boundary and keeps MLS headers opaque below the `Connection` layer.
3. **Application identities are group-local member numbers.** `MemberNumber` is a monotonically assigned `u32`, starting
   at zero, representing join order. A removed number is never reused. It is not an MLS leaf index.
4. **Public keys are absent from application data and transport routing.** They may exist only in the unchanged
   signaling exchange, the local encrypted contact/roster records and the cryptographic MLS state where signature keys
   are required.
5. **A member number is derived from the authenticated MLS sender.** A payload is never trusted to declare its own
   author. The local roster maps the sender credential/leaf to a stable `MemberNumber`.
6. **Use a group-scoped MLS signing identity.** Do not reuse one MLS signing key across unrelated conversations. During
   direct-chat bootstrap, the already authenticated Ephemon transport binds a fresh MLS credential to member `0` or `1`.
   This avoids a stable MLS credential becoming a cross-group correlation handle.
7. **Do not use a naive longest-chain rule.** A longer state is accepted only when its MLS commit head is a proven
   descendant of the local head. Divergent commits for the same epoch are a fork, not mergeable history.
8. **Application events are merged, not globally elected.** Concurrent valid messages from different members all
   survive. Replication uses per-member hash chains/frontiers and set union, with deterministic presentation order.
9. **For the two-member phase, the commit policy is `OwnerOnly`.** The creator starts as owner and member `0`. Other
   members send proposals; the current owner serializes them into commits. Commit authorization is a versioned policy,
   not a hard-coded member-number check, so it can be replaced for real groups without changing lower protocol layers.
10. **Only the mutually confirmed legacy intersection is imported.** At first MLS connection, both members compare keyed
    canonical-record digests, authenticate one intersection manifest, and re-publish only records present on both sides
    as MLS events with explicit legacy provenance. Non-intersecting records remain local.

## 3. Security and privacy invariants

Every increment must preserve these invariants.

### 3.1 Network unlinkability

- No established-channel frame contains sender or recipient public keys.
- A link frame contains only a wire version, frame kind, random routing/stream identifier, content-addressed message ID,
  fragmentation metadata and encrypted payload.
- The random conversation routing ID is created at bootstrap and delivered through the encrypted Ephemon link. It is not
  derived from either participant's public key.
- Application event IDs, reply references, receipts, reactions and sync summaries use group-local member numbers and
  hashes, never identity keys.
- MLS application and handshake messages use `PrivateMessage` unless OpenMLS requires another form for a specific
  bootstrap operation; even then, the bytes remain inside the encrypted Ephemon link.
- An outside observer can still observe that two endpoints establish an Ephemon connection. That metadata already exists
  in the signaling protocol and is outside this change. The goal here is to keep data messages unlinkable and preserve
  the existing promise that private messages have no sender/recipient marks.

### 3.2 Authentication

- Cryptographic keys are unavoidable inside an MLS KeyPackage and ratchet tree, but they are not application identities.
- The application exposes only `MemberNumber` after validating the MLS sender and consulting the encrypted roster.
- A received event that claims an author field is rejected; author information comes from OpenMLS processing results.
- A member locator (`Ephemon public key + server URL`) is stored only in the encrypted roster and is never copied into a
  message/event ID or a clear link header.

### 3.3 State integrity

- A peer never sends or replaces our raw MLS state snapshot.
- Peers exchange summaries, then transfer missing original MLS wire messages. Local state advances only by processing
  and validating those messages through OpenMLS.
- A larger epoch, longer log or higher counter is not trusted without a verified ancestry path.
- Duplicate, reordered and relayed wire messages are expected and idempotent at the replication boundary.

## 4. Replication model

Calling the design "blockchain-like" is useful only in the sense of content-addressed append-only history. There is no
proof of work, quorum or safe longest-chain consensus. MLS state and chat history have different merge rules.

### 4.1 MLS control log

The MLS control log is a linear sequence of accepted commits:

```text
CommitHead {
    epoch: u64
    confirmedTranscriptHash: Hash
    commitWireHash: Hash
}
```

Each stored commit record includes its parent head, exact MLS wire bytes, resulting head and processing status. Sync
rules:

1. Equal heads: no control sync is needed.
2. Remote head is a verified descendant: request and process each missing commit in order.
3. Local head is a verified descendant: offer the missing commits to the remote peer.
4. Same epoch with different transcript hashes, or histories with no ancestry relation: declare a fork and stop emitting
   new MLS data until the owner selects a canonical head and recovery succeeds.

For direct chats, the `OwnerOnly` policy authorizes one committer and the browser enforces a single local writer, so
rule 4 should only be reachable after corruption, a software defect, restored stale storage or deliberate equivocation.
The first implementation detects and quarantines such a fork. The owner explicitly selects a canonical head through a
signed link-level recovery operation; the implementation does not silently choose the longest branch.

### 4.2 Application event log

Application messages do not form one global chain. Each authenticated member has an independent append-only chain:

```text
EventIdentity {
    author: MemberNumber       // derived after MLS authentication
    sequence: u64
    previous: Hash | null
    contentHash: Hash
}
```

An event payload contains no public key and does not need to contain `author`; that field is attached after OpenMLS has
authenticated the sender. Persistent event kinds initially cover:

- `message.created`;
- `message.received` and `message.seen`, keyed by recipient `MemberNumber`;
- `reaction.set`, keyed by reactor `MemberNumber`;
- future edit/delete events.

Typing remains an ephemeral MLS application event and is not part of the durable frontier.

Replica summaries contain a per-member contiguous sequence, head hash and compact description of holes. Valid concurrent
chains are merged by union. A fork in one member's chain (two different events with the same sequence/previous hash) is
reported as equivocation and resolved by an explicit deterministic policy; it does not discard unrelated members'
events.

UI ordering is deterministic but is not a consensus rule. The initial ordering key is:

```text
(hybridLogicalTime, MemberNumber, sequence, eventHash)
```

Replies target an event hash rather than `(timestamp, you|peer)`.

### 4.3 Anti-entropy session

When a peer connection becomes open or degraded:

1. Exchange a link-encrypted inventory of shared random conversation routing IDs.
2. For every shared conversation, exchange `CommitHead` and application frontier digest.
3. Reconcile the MLS control log first.
4. Transfer missing application ciphertexts grouped by epoch and in dependency order.
5. Process, persist and acknowledge each accepted wire message idempotently.
6. Repeat frontier exchange until both sides report the same control head and event root, or until the session is
   interrupted.

Any group member may store and forward exact opaque MLS wire bytes created by another member. A relay does not decrypt,
modify or re-encrypt the inner MLS message. The receiving OpenMLS instance authenticates the original sender.

For the initial two-member phase, both replicas should converge to the same complete post-upgrade event set. For later
groups, connecting to any sufficiently up-to-date member is enough to begin catch-up; the client still attempts to
connect to every known active roster member in parallel.

### 4.4 Epoch retention

Offline delivery and forward secrecy pull in opposite directions. The initial policy is:

- store original MLS ciphertext/event records until local history is cleared;
- avoid routine direct-chat commits while the other member is offline;
- when advancing an epoch, send all known old-epoch events before the commit;
- retain a bounded number of past-epoch message secrets for delayed/reordered delivery;
- configure maximum forward-ratchet distance and maximum stored skipped keys;
- if a peer is behind the retained window, require an explicit resync/rejoin instead of retaining secrets forever.

Exact bounds are selected from browser tests and documented before release.

## 5. Target layers

```text
UI / Chat reducer
        │  application events addressed by MemberNumber
ConversationService
        ├── MlsSession (one persistent state per conversation)
        ├── EventLog / CommitLog / Roster
        └── ReplicationService (anti-entropy, outbox, acknowledgements)
                  │ opaque binary frames
Connection(peer public key, server URL)
        ├── incoming saga ── RTCPeerConnection
        └── outgoing saga ── RTCPeerConnection
                  │
        unchanged signaling server
```

The peer public key is a transport locator below `ConversationService`; it is not a chat ID, message author ID or
message field.

## 6. Persistence model

New encrypted vault records are introduced through normal schema migrations:

```text
conversations
    localConversationId
    kind: direct | group
    randomRoutingId
    title/settings
    upgradeBoundary

conversation_members
    localConversationId
    memberNumber
    status
    encrypted transport locator
    MLS credential fingerprint / current leaf binding

mls_checkpoints
    localConversationId
    committed OpenMLS storage snapshot
    pending operation metadata

mls_commits
    localConversationId + epoch/commit hash
    parent/result heads
    original wire bytes

conversation_events
    localConversationId + event hash
    original MLS wire bytes
    authenticated author number
    decoded local view data

replication_outbox
    localConversationId + wire hash + destination member number
    delivery/ack state
```

OpenMLS storage calls are synchronous while IndexedDB is asynchronous. The WASM facade therefore uses an in-memory
provider with import/export checkpoints. Every mutating command returns a bundle containing the next checkpoint and all
outbound messages. JavaScript commits that bundle in one IndexedDB transaction. If the transaction fails, the worker
reloads the last committed checkpoint before accepting another command.

Only one tab may mutate MLS state. Use `navigator.locks` where available, with a tested IndexedDB lease fallback. Other
tabs become read-only observers and forward commands to the owner tab.

## 7. Binary Ephemon data plane

The public data API changes to:

```ts
Connection.send(data: Uint8Array): void;
Connection.onMessage?: (data: Uint8Array) => void;
```

The same change is made internally on `ConnectionSaga`. Signaling types and saga states do not change.

Binary behavior:

- explicitly set `RTCDataChannel.binaryType = 'arraybuffer'`;
- accept `ArrayBuffer` and typed-array views without UTF-8 conversion;
- remove `.trim()`, `gzip` and `ungzip` from the data path;
- keep per-saga Secretbox encryption and fresh nonces;
- copy/slice buffers at ownership boundaries so WASM memory growth cannot invalidate queued data;
- introduce a versioned frame header with no identity fields;
- fragment large Welcome/ratchet-tree messages according to negotiated SCTP limits;
- cap total reassembly size, fragment count and lifetime;
- add `bufferedAmount` backpressure and bounded queues;
- hash/deduplicate the complete inner wire message, not individual encrypted fragments.

During the transport-only increment, the existing JSON chat protocol uses an explicit UTF-8 adapter above `Connection`
so behavior remains unchanged while the core becomes binary.

## 8. OpenMLS WASM boundary

Create a Rust workspace crate owned by `ephemon-core`, pinning an audited OpenMLS release and its dependency graph. Do
not depend directly on the experimental generic `openmls-wasm` API.

The first facade exposes commands equivalent to:

```text
initialize(checkpoint?)
create_group(group_id, own_member_number, credential)
create_key_package(group_context, member_number)
stage_add(key_package)
join(welcome, ratchet_tree)
merge_pending_commit()
process_mls_message(bytes)
create_application_message(bytes)
propose_self_update()
export_checkpoint()
inspect_head_and_roster()
```

Every call returns structured results: outbound MLS bytes, authenticated sender/handshake metadata, next state
checkpoint and typed failure. Production bindings contain no `unwrap`, panic-based control flow or key logging.

The facade runs in a dedicated Worker. JavaScript receives neither secret group state nor signing private keys after
initialization. Worker restart and PWA asset-version mismatch are explicit tested cases; JavaScript glue and `.wasm`
must be cached and upgraded atomically by the service worker.

## 9. Increment sequence

Each increment is independently reviewable and leaves tests green. No increment changes the signaling server.

### Increment 0 — Freeze invariants and build the adversarial harness

Deliverables:

- architecture tests asserting the current two-saga negotiation and first-connected/failover behavior;
- a packet-capture test seam around `RTCDataChannel.send`;
- deterministic fake transport supporting drop, duplicate, reorder, disconnect and reconnect;
- crash-point helpers around IndexedDB transactions;
- protocol fixtures versioned separately from TypeScript DTOs;
- a CI job that builds/tests the future WASM target in a real browser.

Exit criteria:

- existing core tests stay green;
- the harness can reproduce duplicate delivery, saga failover and two offline peers reconnecting.

### Increment 1 — Convert `Connection` and both sagas to binary

Deliverables:

- `Uint8Array` send/receive API through core and application callbacks;
- removal of implicit trimming and text compression from the transport;
- explicit UTF-8 adapter for the still-legacy JSON chat protocol;
- binary round-trip tests for zero bytes, non-UTF-8 data and exact buffer equality;
- tests proving incoming/outgoing saga selection and failover remain unchanged;
- tests proving signaling calls and payload models are byte-for-byte unchanged.

Exit criteria:

- current personal chat behavior works through the compatibility adapter;
- arbitrary binary payloads survive either saga and relay fallback unchanged after decryption.

### Increment 2 — Prove a minimal two-member OpenMLS Rust/WASM vertical slice

Deliverables:

- an exact audited OpenMLS release and reproducible Rust/WASM dependency graph;
- a project-owned facade, not a TypeScript implementation of any MLS primitive;
- group-scoped credentials and KeyPackages for two isolated clients;
- group creation, member addition, Commit/Welcome exchange and join;
- MLS application-message creation and authenticated processing;
- state export/import sufficient to restart both clients and continue the same group;
- a real-Chromium Docker test recording serialized KeyPackage, Commit, Welcome, application-message and checkpoint
  sizes.

Exit criteria:

- two browser instances establish a two-member MLS group and exchange an application message using OpenMLS;
- both instances restart from exported state and exchange another message in the same group;
- no secret material crosses into serializable UI state or appears in logs;
- the next transport limits can be based on measured OpenMLS artifacts rather than synthetic assumptions.

### Increment 3 — Separate conversations from transport connections

Deliverables:

- `ConversationId`, `Conversation`, `MemberNumber`, `ConversationMember` models;
- migrations from peer-key-indexed UI/history records to conversation-indexed records;
- `Connection` retained as a transport registry keyed by peer public key;
- routine transport lifecycle no longer tied to conversation deletion; the explicit `onClosedByPeer` delete signal is
  dispatched through the conversation's deletion policy;
- UI state stores keyed by `ConversationId`, not public key;
- message model generalized from `you|peer` to authenticated `MemberNumber` while preserving the current two-person UI.

Exit criteria:

- losing a transport does not delete a conversation; explicit peer deletion still cascades for a personal chat under
  D-008;
- one conversation can rebind to a recreated connection;
- no application message DTO contains a public key.

### Increment 4 — Harden the project-specific OpenMLS WASM worker and storage boundary

Deliverables:

- pinned Rust/OpenMLS workspace and reproducible WASM build;
- project-specific bindings and typed TypeScript client;
- browser randomness/time configuration;
- group-scoped signing credential generation;
- import/export of the in-memory provider checkpoint;
- encrypted IndexedDB stores and atomic checkpoint transaction API;
- unit, Rust/WASM and browser smoke tests using official MLS test vectors where applicable.

Exit criteria:

- two isolated browser workers create a two-member group, exchange an application message, restart and continue;
- no secret material appears in logs or serializable UI state;
- a failed checkpoint transaction rolls the worker back to the prior committed state.

### Increment 5 — Bootstrap a direct conversation as a two-member MLS group

Deliverables:

- link-control bootstrap protocol with explicit version negotiation;
- deterministic creator election using already-known transport identities, without putting those identities in link
  frames;
- creator assigned `MemberNumber = 0`, invitee assigned `MemberNumber = 1`;
- one-time group-scoped KeyPackage exchange;
- random MLS group ID and random routing ID;
- durable staged Commit/Welcome/ack flow;
- recovery for disconnect/crash at every bootstrap transition;
- local encrypted roster binding MLS credentials and member numbers to transport locators.

Exit criteria:

- simultaneous open attempts create exactly one MLS conversation;
- both members persist the same epoch/transcript head and roster;
- no Welcome is accepted after its KeyPackage has already been consumed;
- bootstrap resumes after either process crashes at any recorded transition.

### Increment 6 — Route all new direct-chat operations through MLS

Deliverables:

- versioned application event codec;
- MLS encryption/processing for text, delivery, seen, reaction and typing events;
- author derived from processed MLS sender and translated to `MemberNumber`;
- message/reply IDs changed from timestamps and `you|peer` to event hashes;
- current plaintext `history` replay disabled for MLS conversations;
- exact original MLS ciphertext retained for retransmission;
- compatibility UI rendering `0/1` as `you/peer` only at the view boundary.

Exit criteria:

- no post-upgrade chat operation uses the legacy plaintext JSON channel;
- replaying the same MLS wire message through both sagas changes the UI/state once;
- a payload cannot impersonate the other member by declaring another member number;
- captured established-channel frames contain no structural sender/recipient identity fields.

### Increment 7 — Add durable application log and anti-entropy for two members

Deliverables:

- per-member sequence/hash chains and persistent frontier;
- content-addressed commit and event stores;
- inventory, request, batch and acknowledgement link-control frames;
- ancestry verification for commit heads;
- resumable sync sessions after disconnect;
- deterministic merge/reducer for messages, receipts and reactions;
- history-clear semantics that do not accidentally delete the live MLS state.

Exit criteria:

- either peer may remain offline while the other creates messages, then converge after reconnect;
- dropped, reordered and duplicated sync batches converge to the same event root;
- a fabricated longer log containing invalid MLS messages is rejected;
- concurrent valid application events are both retained rather than choosing one longest branch.

### Increment 8 — Commit authorization, serialization and fork recovery

Deliverables:

- versioned `CommitPolicy` state machine with the initial `OwnerOnly` policy;
- staged inbound-commit authorization before merge, using authenticated sender and current owner metadata;
- protocol shapes for future ownership transfer and policy transitions, without exposing them in the initial UI;
- proposal queue and acknowledgements;
- self-update scheduling only when the direct peer can receive the transition;
- bounded old-epoch/skip-key retention policy;
- single-writer tab lock and stale-tab fencing token;
- explicit fork/corruption state in the UI and diagnostics;
- safe branch metadata and explicit owner selection of the canonical commit head;
- replay-protected, owner-signed `ForkResolution` control operation outside either conflicting MLS epoch;
- recovery path: restore a common checkpoint and replay the selected branch, otherwise perform authenticated rejoin;
- re-publication of recoverable losing-branch application events only by their original authenticated authors.

Exit criteria:

- simultaneous proposals produce one commit;
- a stale tab cannot reuse an MLS generation or publish a competing commit;
- different commits for one epoch are detected and never resolved by an unverified longest-chain comparison;
- the owner's selected branch converges through replay or rejoin without importing another peer's MLS snapshot;
- restart before/after commit merge preserves a usable canonical state.

### Increment 9 — Migrate existing personal conversations and remove the legacy protocol

Deliverables:

- persisted migration/upgrade state machine per conversation;
- canonical legacy-record codec that maps `you|peer` to stable member numbers;
- MLS-exporter-keyed history inventory and exact intersection calculation;
- MLS-authenticated intersection-manifest approval by both members;
- idempotent import batches authored by each original sender and verified against the receiver's local copy;
- visible provenance boundary between local-only legacy records, imported intersection records and native MLS events;
- upgrade-required behavior for incompatible old clients; no silent plaintext downgrade;
- removal of legacy `UpdateType.history` replay and text adapters after the supported migration window;
- cleanup of now-unused pako/text message dependencies and obsolete schema fields;
- updated protocol diagram and public security guarantees.

Exit criteria:

- every active direct conversation is either explicitly pre-upgrade or MLS, never ambiguous;
- an active attacker/old peer cannot force downgrade from MLS to plaintext;
- upgraded peers persist the same approved legacy intersection and synchronize all post-boundary events;
- records absent from either local history remain local and are excluded from MLS anti-entropy;
- an imported timestamp is displayed as legacy metadata and is not represented as MLS-authenticated send time.

### Increment 10 — Direct-chat hardening gate

Deliverables:

- multi-browser interoperability matrix, including background/PWA/restart behavior;
- long offline/reconnect soak tests;
- property/fuzz tests for frame and event codecs;
- malicious-member tests, high generation counters and oversized payloads;
- WASM bundle/performance budgets and mobile memory measurements;
- dependency audit/SBOM and review of which OpenMLS audit version is pinned;
- an external review checklist covering the Rust facade, persistence, identity binding and replication policy.

Exit criteria:

- no known state-loss path in the crash matrix;
- all privacy invariants have automated regression tests;
- two-member MLS is the default path and is stable enough to become the primitive for groups.

### Post-direct-chat group-scale gate — Add measured framing, fragmentation and backpressure

This gate is intentionally not on the critical path for two-member MLS migration. Increment 2 measured a two-member
KeyPackage at 282 bytes, add Commit at 697 bytes and Welcome at 801 bytes, all comfortably below ordinary data-channel
message limits. Revisit the transport only with real multi-member artifacts and target-browser SCTP measurements.

Deliverables:

- versioned identity-free link frame codec sized from real group measurements;
- random stream/routing IDs and content-addressed wire IDs;
- fragmentation/reassembly with hard resource limits;
- bounded outbound queue driven by `bufferedAmountLowThreshold`;
- duplicate complete-message suppression before upper-layer dispatch;
- malformed-frame and resource-exhaustion tests.

Exit criteria:

- measured multi-member Welcome and Commit data cross fake and browser transports under configured limits;
- interrupted fragments expire without retaining unbounded memory;
- saga failover can resend a whole logical frame without duplicate upper-layer delivery.

## 10. Later group-chat increments

These begin only after Increment 10 passes.

1. Generalize the roster to `N` monotonically numbered members and preserve numbers across MLS leaf moves.
2. Add a transport orchestrator that continuously attempts connections to all active roster locators with bounded
   parallelism and backoff.
3. Allow anti-entropy and opaque store-and-forward through any connected member.
4. Add membership Proposal/Commit events and Welcome forwarding.
5. Add another versioned `CommitPolicy` implementation when multi-writer or delegated commits are required. Coordination
   cannot be inferred safely from "currently online" peers during a partition; the new policy must define leases,
   deterministic fork recovery or a group home service before multi-writer commits are enabled.
6. Add aggregate online/sync status instead of projecting a group's state from one peer connection.
7. Load-test partial meshes and define supported group-size/resource limits.

## 11. Required test scenarios before real groups

- Alice sends while Bob is offline; Bob later catches up from Alice.
- Both send while temporarily disconnected after retaining the same epoch; event logs merge without losing either
  message.
- Incoming saga carries the first half of a sync, fails, and outgoing saga resumes it.
- The same MLS ciphertext arrives directly and through a later gossip relay.
- A peer advertises a higher epoch but cannot supply a valid commit ancestry path.
- A peer supplies a longer application chain containing a broken previous hash or invalid MLS authentication.
- Two owner commits fork one epoch; traffic pauses until an authenticated owner selection, then replicas converge on the
  selected branch and retain recoverable losing-branch events.
- A stale browser tab attempts to send using old MLS state.
- Either browser crashes before and after every persistence/send/ack boundary in bootstrap, application send and commit.
- A delayed old-epoch application message arrives inside and outside the retention window.
- Public-key byte strings and key-shaped fields are absent from decoded link headers and application schemas.
- Clearing history, deleting a conversation and losing a transport have distinct, tested semantics.

## 12. Explicit non-goals for the direct-chat phase

- No signaling-server changes and no server-side MLS Delivery Service.
- No offline KeyPackage directory.
- No arbitrary multi-member commit consensus.
- No import of another peer's serialized MLS state.
- No global blockchain, proof of work, quorum or "trust the longest unverified log" behavior.
- No attempt to hide the existence of an Ephemon connection from the signaling server or network endpoints.
- No promise of indefinite recovery for a peer that is older than the configured retained-epoch window.

## 13. Resolved review checklist

All implementation-blocking decisions were accepted on 2026-08-03/04 and are recorded with rationale in
[`mls-decisions.md`](./mls-decisions.md):

- [x] group-scoped MLS signing credentials rather than reuse of the long-term Ephemon signing key;
- [x] stable monotonically increasing `MemberNumber` distinct from MLS leaf index;
- [x] `OwnerOnly` as the initial, replaceable commit policy, with the creator as first owner;
- [x] mutually approved legacy-history intersection, local-only remainder and explicit import provenance;
- [x] application-log merge by per-member chains rather than a global longest chain;
- [x] explicit quarantine and owner-selected recovery of divergent commit histories;
- [x] continued outer Secretbox encryption for all binary/MLS data frames;
- [x] no signaling contract or saga-state-machine changes.
