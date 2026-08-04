# MLS architecture decision log

This document is the source of truth for architectural decisions made during review of
[`mls-everywhere-plan.md`](./mls-everywhere-plan.md).

Only decisions explicitly answered by the project owner receive the `accepted` status. Pending questions are considered
unresolved and must not be treated as implementation requirements.

## D-001 — MLS signing identity scope

Status: accepted  
Asked: 2026-08-03 Accepted: 2026-08-03

Question: should each conversation use a fresh group-scoped MLS signing key pair, or should MLS reuse the long-term
Ephemon signing identity?

Recommended option: a fresh group-scoped signing key pair for each conversation. The existing authenticated Ephemon
connection binds that key to the peer during bootstrap. The long-term Ephemon public key remains a transport locator and
does not occur in MLS application messages.

Alternative: reuse the long-term Ephemon signing key in MLS. This simplifies identity binding but creates a stable value
that can correlate the same participant across otherwise unrelated conversations.

Decision: every conversation uses a fresh group-scoped MLS signing key pair.

Required product behavior and consequences:

- the existing Ephemon public key remains the user's account address and continues to be sufficient for another user to
  find and call them;
- MLS key creation, binding and storage are automatic and invisible to the user;
- starting or opening a chat must not introduce another identity-selection, key-exchange or verification step;
- the authenticated Ephemon connection binds the conversation-scoped MLS credential to the contacted account during
  bootstrap;
- the group-scoped MLS public key is not used for signaling, account discovery or transport routing;
- losing or rotating a conversation-scoped MLS key is handled as conversation-state recovery and does not change the
  user's Ephemon account address.

## D-002 — Stable group-local member numbers

Status: accepted  
Asked: 2026-08-03 Accepted: 2026-08-03

Question: should the application identify group members using monotonically assigned group-local numbers that are
independent of MLS leaf indexes?

Recommended option: the creator receives `MemberNumber = 0`; each join receives the next unused number. A number remains
stable while that membership exists and is never reassigned to another membership. A member that leaves and later
rejoins receives a new number. MLS leaf indexes remain internal and may change without affecting messages or the UI.

Decision: use stable, monotonically assigned, group-local `MemberNumber` values with the recommended semantics.

Consequences:

- message authorship is derived from the authenticated MLS sender and then mapped to `MemberNumber` by the local roster;
- application references, receipts and reactions may use `MemberNumber`, but never an MLS leaf index or Ephemon public
  key;
- membership records remain distinguishable across leave/rejoin cycles;
- the implementation must not compact or renumber the roster.

## D-003 — Commit authority in two-member conversations

Status: accepted  
Asked: 2026-08-03 Accepted: 2026-08-03

Question: during the two-member phase, should only member `0` be allowed by application policy to create MLS commits?

Recommended option: member `0` is the sole committer. Member `1` sends proposals, which member `0` serializes into a
commit. Both members may continue sending ordinary MLS application messages in the current epoch while member `0` is
offline, but epoch changes and updates wait for member `0` to reconnect.

Alternative: allow both members to create commits. This removes dependence on member `0` for epoch advancement but
requires immediate handling of concurrent same-epoch commits and deterministic fork recovery before the direct-chat MVP.

Decision: use a versioned commit-authorization policy. The initial policy is `OwnerOnly`; the group creator is its first
owner and has `MemberNumber = 0`. Non-owners may send MLS proposals, but only the current owner may create a commit that
confirms them and advances the epoch.

Required extensibility and consequences:

- commit authorization is represented by a `CommitPolicy` interface/state machine in the conversation layer; it is not a
  hard-coded `memberNumber === 0` condition in OpenMLS bindings, transport framing, persistence or replication;
- the current owner and policy version are authenticated conversation metadata persisted with the MLS checkpoint;
- an inbound commit is staged, its authenticated sender is resolved to a `MemberNumber`, and the active policy is
  checked before the commit is merged;
- an unauthorized commit is never merged merely because it is structurally valid MLS data;
- the control protocol reserves versioned policy-transition and ownership-transfer operations, although the direct-chat
  phase does not need to expose them in the UI;
- future policies such as delegated committers or a deterministic coordinator can replace `OwnerOnly` without changing
  Ephemon signaling, binary link framing, MLS-message storage or the application-event log;
- ordinary application messages remain available to every active member in the current epoch; only epoch advancement
  waits for an authorized committer.

## D-004 — Legacy direct-chat history at the MLS upgrade boundary

Status: accepted  
Asked: 2026-08-03 Accepted: 2026-08-03

Question: should messages created before a direct conversation is upgraded to MLS remain local legacy history, or should
the upgrade attempt to import and replicate them?

Recommended option: retain legacy messages locally and render a durable upgrade boundary in the conversation. Only
events created after that boundary enter the authenticated MLS event log. This avoids presenting old peer-supplied
plaintext as MLS-authenticated history and avoids conflicts between different local copies.

Alternative: define a separate, explicitly unverified archive-import protocol for old history. Old messages cannot be
honestly converted into newly authenticated MLS messages from their original senders, so imported records would need
different trust and UI semantics.

Decision: on the first successful MLS connection, import only the exact intersection of the two participants' legacy
histories. Records that are not present identically on both replicas remain local and never enter MLS anti-entropy.

Migration protocol and consequences:

- bootstrap the two-member MLS group before exchanging migration data;
- canonicalize each legacy record by replacing local `you|peer` perspective with the corresponding stable `MemberNumber`
  and using a versioned deterministic encoding;
- derive a migration-scoped comparison key from an MLS exporter secret and exchange keyed record digests rather than raw
  content inventories;
- build one intersection manifest and require an MLS-authenticated approval of its root from both members;
- after approval, each member publishes import batches only for historical messages originally authored by that member;
- the receiver verifies every imported record against its own copy and the approved manifest;
- receipts, reactions and other legacy state are imported as separately attributed events only when their canonical
  state satisfies the same intersection/attestation rules;
- imported events carry explicit `legacy-intersection` provenance: MLS authenticates who imported the record now, not
  its claimed original send time;
- the protocol is idempotent and resumable across disconnects and crashes; the migration boundary is finalized only
  after both sides persist the same manifest and accepted import set.

## D-005 — Merge rule for concurrent application history

Status: accepted  
Asked: 2026-08-03 Accepted: 2026-08-03

Question: when members create ordinary application messages while disconnected, should valid per-member histories be
merged by union instead of electing one global longest history?

Recommended option: maintain one authenticated sequence/hash chain per `MemberNumber`. Preserve every valid concurrent
event and present the merged result using a deterministic ordering key. The ordering is a UI/reducer rule, not consensus
and not an MLS commit order.

Alternative: require one globally sequenced application log. This either prevents non-sequencer members from finalizing
messages while the sequencer is offline or requires a separate consensus/fork-resolution protocol. Choosing the longest
branch alone would discard valid messages from the losing branch.

Decision: merge valid application histories using one authenticated append-only sequence/hash chain per `MemberNumber`.
Do not elect a global longest application chain.

Compatibility and consequences:

- this preserves the convergence behavior intended by the existing bidirectional history replay while replacing
  timestamp/sender deduplication with stable cryptographic event identities;
- events from different members never conflict merely because they were created concurrently or while disconnected;
- a gap in one member's sequence does not discard valid events from another member;
- two different events claiming the same author, sequence and predecessor are author equivocation/corruption and are not
  resolved by deleting unrelated history;
- deterministic merged display order is separate from the validity and replication rules.

## D-006 — Recovery from divergent MLS commit histories

Status: accepted  
Asked: 2026-08-03 Accepted: 2026-08-03

Question: if replicas discover incompatible MLS commits descending from the same epoch, should the conversation
quarantine the fork instead of automatically selecting the longer branch?

Recommended option: stop creating new MLS traffic, preserve both branches for diagnostics, and recover from a retained
common checkpoint or perform an authenticated resync/rejoin. Never import another peer's serialized MLS state and never
choose a branch solely by epoch or length.

Alternative: define an automatic deterministic branch-selection and rollback protocol. This is possible, but rollback
can invalidate already displayed/sent application ciphertext and requires a substantially larger recovery design even
with the initial `OwnerOnly` commit policy.

Decision: a genuine MLS fork pauses new MLS operations until the current group owner explicitly selects the canonical
commit head. The selection is an authenticated recovery operation; branch length or epoch alone never makes the choice.

Recovery protocol and consequences:

- show the owner safe branch metadata such as epoch, commit hash, receipt time, roster summary and availability of a
  local checkpoint; do not require exposing application plaintext in recovery control frames;
- encode a replay-protected `ForkResolution` containing the conversation's random routing ID, fork identifier, chosen
  and rejected commit heads, policy version and resolution sequence;
- sign the resolution using the owner's group-scoped signing authority from the last common state; verifiers use the key
  already stored in their roster, so the recovery payload does not contain a public key;
- carry the recovery operation through an established encrypted Ephemon connection, outside either conflicting MLS
  epoch;
- restore a retained common checkpoint and replay original commits toward the selected head; never import a peer's
  serialized MLS state;
- if replay is impossible, perform an authenticated rejoin into the selected branch;
- preserve the rejected branch until recovery completes; application events from it may be re-published on the canonical
  branch only by their original authenticated authors and carry `recovered-from-fork` provenance;
- represent fork-resolution authority as a replaceable policy role rather than hard-coding member `0`, so future group
  administration models can change it;
- signing contradictory resolutions for the same fork is detectable owner equivocation and cannot be repaired by an
  automatic longest-branch rule.

## D-007 — Outer encryption for MLS link frames

Status: accepted  
Asked: 2026-08-03 Accepted: 2026-08-04

Question: should MLS wire messages remain wrapped in the existing per-saga Secretbox after the data channel is converted
to binary?

Recommended option: keep Secretbox. WebRTC DTLS already prevents TURN/network intermediaries from reading data-channel
content, while the existing outer layer preserves an independent Ephemon link-encryption boundary above WebRTC. It keeps
MLS headers and non-MLS recovery control opaque below the Ephemon connection layer and avoids weakening the current
transport contract during the MLS migration.

Alternative: remove Secretbox for established data frames and rely on MLS plus WebRTC DTLS. This reduces one encryption
and buffer-copy step but changes the current Ephemon transport security boundary and exposes more protocol metadata at
the link endpoints.

Decision: retain the existing per-saga Secretbox when the established data path is converted from text to binary.

Consequences:

- signaling encryption and contracts remain unchanged;
- each identity-free binary link frame is encrypted by the selected saga before `RTCDataChannel.send`;
- MLS wire messages and non-MLS link-control/recovery messages use the same outer transport protection;
- fragmentation, retries and saga failover operate on bounded binary frames, each independently protected by Secretbox;
- transport compression is still removed; binary MLS data is not converted to text or compressed before encryption;
- removing the outer layer later requires a separate reviewed protocol decision and is not part of the MLS migration.

## D-008 — Remote conversation deletion semantics

Status: accepted  
Asked: 2026-08-04 Accepted: 2026-08-04

Question: should the current `closeByPeer` callback be reinterpreted as an ephemeral transport loss once conversations
are separated from connections?

Decision: no. `closeByPeer` represents an explicit remote close/delete action, not an incidental network disconnect. In
the current personal-chat protocol it keeps its existing cascading behavior: deletion by one participant deletes the
conversation and local history for the other participant as well.

Required group-chat behavior and consequences:

- an ordinary transport failure or saga state transition never deletes durable conversation state;
- a group is not deleted merely because one member closes a peer transport;
- group deletion is a versioned conversation-level authorization operation, initially controlled by the group admin;
- when a group has only two participants remaining, its conversation policy enables reciprocal chat-on-two deletion
  semantics;
- an admin-authorized group deletion cascades through an authenticated group operation rather than by treating a single
  peer transport close as deletion of the whole group;
- transport callbacks do not hard-code future group membership or admin rules; they dispatch the explicit close event to
  the active conversation policy.

## D-009 — Self-chat protocol exception

Status: accepted  
Asked: 2026-08-04 Accepted: 2026-08-04

Question: should a connection whose peer Ephemon public key equals the local account public key bypass MLS and retain
the previous chat-update protocol over the established binary transport?

Decision: yes. Self-chat is an explicit exception to MLS-for-all. It sends the existing chat-update JSON as UTF-8 bytes
directly through the binary Ephemon `Connection`; it does not create an MLS group, bootstrap a second role or load the
MLS worker.

Consequences:

- the exception is selected from local connection metadata, not from a sender identifier in the message;
- self-chat payloads contain no account public key and remain protected by the unchanged per-saga Secretbox and WebRTC
  DTLS transport layers;
- the existing connection-open history replay remains responsible for delivering messages created while disconnected;
- ordinary direct chats and future group chats continue to require MLS;
- no core, connection-saga or signaling contract changes are introduced for self-chat.
