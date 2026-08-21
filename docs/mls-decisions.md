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

Status: superseded by [D-010](#d-010--drop-pre-mls-history-and-its-migration-path) on 2026-08-04  
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

## D-010 — Drop pre-MLS history and its migration path

Status: accepted  
Asked: 2026-08-04 Accepted: 2026-08-04

Question: the messenger has no released clients yet. Should the implementation keep supporting history created before
MLS, or delete that support and start from a single schema that only knows MLS conversations and self-chat?

Decision: delete it. There is no deployed client whose history must survive, so pre-MLS history, the vault import chain
and the upgrade boundary are removed. One migration creates the current stores and performs no data conversion.

This supersedes D-004. The keyed legacy-history intersection, its manifest approval, the per-author import batches and
the `legacy-intersection` provenance are all withdrawn: with no pre-MLS records there is nothing to intersect.

Consequences:

- migrations `001`–`006` and the old-vault import (`hasLegacyVault`, `verifyLegacyPassword`) are replaced by a single
  initializing migration; an existing local vault is not upgraded and is simply replaced;
- a direct conversation is either bootstrapping MLS or is MLS; there is no pre-upgrade state and no upgrade boundary;
- a reply always targets an MLS event hash, so the quoted-legacy-record locator is unnecessary;
- Increment 9 loses the migration protocol and keeps only the removal of what this decision deletes;
- D-009 is unaffected. Self-chat still cannot use MLS, because OpenMLS rejects decrypting its own message
  (`CannotDecryptOwnMessage`), so the chat-update protocol survives as the permanent self-chat transport rather than as
  legacy. Its records keep a direction-scoped identity, because self-chat legitimately holds one message twice, and the
  ordering tie-break by direction exists for exactly those records;
- names that call this path "legacy" are renamed to say self-chat, so the remaining non-MLS path is not mistaken for
  something scheduled for removal.

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

## D-011 — A group is its own conversation, built only from known contacts

Status: accepted  
Asked: 2026-08-10 Accepted: 2026-08-10

Question: an existing one-to-one chat and a group cannot both own the single transport a peer has, so how is a group
created and how is a member added?

Decision: a group is a separate conversation, created explicitly from the contacts this device already has. There is no
"add a member to this one-to-one chat", and no arbitrary public key can be typed into a group: both creating a group and
adding a member to it choose from known conversations. One peer transport therefore carries several conversations, and
an incoming frame is dispatched by its `routingId` to the conversation whose MLS group it belongs to.

Consequences:

- a conversation record gains `kind: 'group'`; its `publicKey` is empty, because a group has no single peer, and its
  member locators live in the encrypted roster that already exists in `mlsBootstrap`;
- every wire frame except `hello` already carries a `routingId`, so the receive path needs a per-transport routing table
  and no protocol change; `hello` belongs to the one-to-one bootstrap and stays with the peer's direct conversation;
- a one-to-one conversation keeps its own MLS group and is unaffected by a group that reuses its transport;
- the add-member entry point is offered only for a group, so the failure the manual test hit -- an invite landing inside
  an existing direct conversation and colliding with its checkpoint -- is not reachable;
- adding a stranger requires the ordinary connect flow first, which is also what makes the invitee's locator known.

## D-012 — Group events propagate by deduplicated flood over the members' transports

Status: accepted Asked: 2026-08-10 Accepted: 2026-08-10

Question: how does an application event reach a member that has no transport to its author, without looping and without
a server?

Decision: two mechanisms with different jobs. A `relay` frame carries an unmodified MLS ciphertext to every transport of
the conversation except the one it arrived on, and a receiver drops a payload whose SHA-256 it has already seen instead
of forwarding it; a hop counter bounds a forged frame. Anti-entropy between any two members remains the delivery
guarantee: a member that was offline during the flood catches up from whoever holds the event, by re-encrypting the
stored plaintext into the current epoch.

Consequences:

- traffic per event is bounded by the number of edges, because each member forwards each distinct payload once;
- the seen set is bounded and lives in memory; after a restart it is seeded from the content-addressed identifiers
  already in the store, so no schema changes;
- a relayed ciphertext is only useful inside its own epoch, which is why anti-entropy, not the flood, is what makes
  delivery eventual;
- forwarding needs no decryption and no re-signing, so a relaying member cannot alter what it passes on;
- nothing depends on the group's owner being online.

## D-013 — A member introduces itself to the group, and unknown callers can be blocked

Status: accepted Asked: 2026-08-10 Accepted: 2026-08-10

Question: where do the author names shown in a group come from, how does a member learn another member's locator, and
what replaces the browser confirm on an incoming dial?

Decision: an ephemeral application event `member.profile` carries the author's chosen name for that group and its own
locator. It is authored on joining -- the creator names itself while creating the group, an invited member before its
first message -- again whenever the name changes, and again whenever one of the group's transports opens. What it
carries is soft state kept in the roster, so it needs no chain position and no place in the durable log: re-announcing
is cheaper than replaying. Its locator makes every member reachable and displayable, so a message can show its author
and offer that author's contact code. An incoming dial from an unknown peer is answered by a modal with three outcomes:
accept, decline once, decline forever; declining forever records the locator in an encrypted blocklist that the sidebar
can list and unblock behind a confirmation.

Consequences:

- names are not a protocol identity: they are self-asserted, per group, and always shown next to the member number the
  MLS sender check produced;
- the roster gains a name per member, so no separate store is needed for group identities;
- distributing locators through the group is what makes the mesh, and the flood in D-012 covers the case where a member
  still cannot reach another directly;
- a blocklist is new persisted state and needs its own store; a blocked locator is refused before any saga starts;
- a member that never announces itself is shown by its short key, so the group keeps working without a profile event;
- a member that was offline while another announced itself learns that name at the next connection, because every
  transport that opens carries an announcement.

## D-014 — A reaction and a receipt belong to the member that authored it

Status: accepted Asked: 2026-08-11 Accepted: 2026-08-11

Question: a message currently holds one reaction and one delivered/seen pair, which was enough for two members. What
does a group need instead?

Decision: both become per-author. A message keeps a set of reactions keyed by target and author, and a bubble shows one
chip per distinct emoji carrying how many members chose it, with the members' names in its title; choosing the same
emoji again drops only that member's reaction. Delivered and seen become per-member as well, and a group does not
collapse them into one verdict: the receipt on an own message opens the list of the group's members, each shown as read,
received or still waiting, the way a group message's read list works in other messengers. The check mark stays as the
short form -- one for delivered to somebody, two once everybody has read it -- but the list, not the mark, is what
answers who has it.

Consequences:

- the durable record model changes: a receipt row is identified by target and author rather than by target alone, so the
  store aggregates instead of overwriting, and the last writer no longer wins;
- a group with a member that never comes back never reaches "read by everybody", and the list is what names it instead
  of leaving the sender guessing;
- one-to-one chats keep their current appearance, because a single other member collapses the aggregate to one name;
- the change is local to the record model and the bubble: the wire events already carry their author, since MLS
  authenticates the sender of every event.
