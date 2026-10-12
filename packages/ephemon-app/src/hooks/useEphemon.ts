import { disposeChatStore, getChatStore } from '../lib/chatStore';
import {
    forgetConversation,
    getActiveConversation,
    getConversationOrder,
    setActiveConversation,
    setConnectionNotice,
    setConversationOrder,
} from '../lib/connectionStore';
import { hasEphemonCore, requireEphemonCore, setEphemonCore } from '../lib/ephemonCore';
import { getLogger } from '../lib/logStore';
import { trackServerSync } from '../lib/netStatusStore';
import { fromSelfChatUpdate, toSelfChatUpdate } from '../lib/selfChatUpdate';
import { getSettings } from '../lib/settingsStore';
import { publishHistoryChange } from '../lib/tabSync';
import { DB_SLUG_TABLE_BLOCKED, DB_SLUG_TABLE_CONNECTIONS, DB_SLUG_TABLE_KEYS, getVault } from '../lib/vault';
import { acquireWriterLock, isWriterLockSupported } from '../lib/writerLock';
import { DirectMlsBootstrapResult, DirectMlsBootstrapSession } from '../mls/DirectMlsBootstrapSession';
import { MlsInviteJoinerSession, MlsInviteOwnerSession, nextMemberNumber } from '../mls/MlsInviteSession';
import { MlsCommitRefusedError, mlsErrorCode, MlsWorkerClient } from '../mls/MlsWorkerClient';
import { sameBytes } from '../mls/byteCodec';
import { ChatChainState, decodeChatChainState, encodeChatChainState } from '../mls/chatChain';
import {
    acceptChatEvent,
    authorChatEvent,
    authorHistoryBatch,
    authorInventoryEvent,
    authorProfileEvent,
    storedChatEventBytes,
} from '../mls/chatEvent';
import {
    ChatClearedFrontier,
    ChatInventory,
    clampOwnAuthorFrontier,
    computeChatFrontier,
    missingForPeer,
} from '../mls/chatFrontier';
import { CommitHead, commitsAfter, relateHeads } from '../mls/commitLog';
import { createConversationSessions, ConversationSessions } from '../mls/conversationSessions';
import {
    assignDirectMlsMembership,
    DirectMlsMembership,
    encodeDirectMlsBootstrapFrame,
    encodeDirectMlsWireFrame,
    MLS_GROUP_ID_BYTES,
    MlsRosterMember,
    ROUTING_ID_BYTES,
    tryDecodeDirectMlsWireFrame,
} from '../mls/directBootstrapProtocol';
import { HybridLogicalTime } from '../mls/hybridLogicalClock';
import { createVaultMlsCheckpointStore } from '../mls/mlsCheckpointStore';
import { membershipFrom, rosterFrom } from '../mls/storedMembership';
import { createTransportRegistry, TransportRegistry } from '../mls/transportRegistry';
import { ChatOperation, InboundChatEvent } from '../types/chatOperation';
import { ChatEventRecord } from '../types/chatRecord';
import { ConversationId, MemberNumber, toConversationId, toMemberNumber } from '../types/conversation';
import { UpdateType } from '../types/updateType';
import { now, serverTime } from '../utils/functions';
import { decodeSelfChatMessage, encodeSelfChatMessage } from '../utils/selfChatTransport';
import { PasswordState } from './usePasswordCheck';
import { useSearchParams } from './useSearchParams';
import {
    Connection,
    ConnectionError,
    ConnectionState,
    ConnectionTransport,
    getPrototype,
    EphemonPrototype,
} from '@ephemon/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type EphemonHookMetadataPasswordState = PasswordState;

type EphemonHookMetadata = {
    needUpdate: boolean;
    unstable: [boolean, string | undefined];
    password: EphemonHookMetadataPasswordState;
    writer: boolean;
};

export type EphemonHookConnectionCallbacks = {
    lifecycle: {
        open: (id: ConversationId) => Promise<void>;
        delete: (id: ConversationId) => Promise<void>;
        addMember: (id: ConversationId, publicKey: string, serverUrl?: string) => Promise<void>;
    };
    view: {
        setOrder: (id: ConversationId, value: number) => void;
        setName: (id: ConversationId, value: string | undefined) => void;
        setMemberName: (id: ConversationId, name: string) => void;
    };
    messaging: {
        send: (id: ConversationId, operation: ChatOperation) => Promise<ChatEventRecord | undefined>;
        history: {
            get: (id: ConversationId) => Promise<Array<ChatEventRecord>>;
            save: (id: ConversationId, upserts: ReadonlyArray<ChatEventRecord>) => Promise<void>;
            clear: (id: ConversationId, records: ReadonlyArray<ChatEventRecord>) => Promise<void>;
        };
    };
    events: {
        setOnProgress: (id: ConversationId, onProgress: (progress: number) => void) => void;
        setOnStateChanged: (
            id: ConversationId,
            onStateChanged: (from: ConnectionState, to: ConnectionState) => void,
        ) => void;
        setOnEvent: (id: ConversationId, onEvent: (event: InboundChatEvent) => void) => void;
    };
};

function hasOwnGroupName(ready: DirectMlsBootstrapResult): boolean {
    const own = ready.membership.roster.find(
        (member) => Number(member.memberNumber) === Number(ready.membership.ownMemberNumber),
    );
    return (own?.name ?? '') !== '';
}

function sameConversation(left: EphemonHookConversation, right: EphemonHookConversation): boolean {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]) as Set<keyof EphemonHookConversation>;
    for (const key of keys) {
        if (left[key] !== right[key]) return false;
    }
    return true;
}

export type StoredClearedFrontier = ReadonlyArray<{ author: number; through: number }>;

/** The protocol's own copy of a group's membership. It moves on every commit, so it is kept out of what the UI reads. */
export type StoredMlsBootstrap = {
    version: 1;
    routingId: ReadonlyArray<number>;
    epoch: string;
    owner: MemberNumber;
    ownMemberNumber: MemberNumber;
    roster?: ReadonlyArray<{
        memberNumber: number;
        publicKey: string;
        serverUrl?: string;
        joinedEpoch?: string;
        name?: string;
    }>;
};

/** What a group shows: who may add members, which member this device is, and the members it can name and reach. */
export type GroupPresentation = {
    owner: MemberNumber;
    ownMemberNumber: MemberNumber;
    members: ReadonlyArray<{ memberNumber: number; publicKey: string; name?: string }>;
};

export type EphemonHookConversation = {
    id: ConversationId;
    kind: 'direct' | 'group';
    publicKey: string;
    name: string | undefined;
    namedByUser?: boolean;
    serverUrl: string | undefined;
    group?: GroupPresentation;
};

function groupPresentationOf(bootstrap: StoredMlsBootstrap): GroupPresentation {
    return {
        owner: bootstrap.owner,
        ownMemberNumber: bootstrap.ownMemberNumber,
        members: (bootstrap.roster ?? []).map((member) => ({
            memberNumber: member.memberNumber,
            publicKey: member.publicKey,
            name: member.name,
        })),
    };
}

function sameGroupPresentation(left: GroupPresentation | undefined, right: GroupPresentation | undefined): boolean {
    if (left === undefined || right === undefined) return left === right;
    return (
        Number(left.owner) === Number(right.owner) &&
        Number(left.ownMemberNumber) === Number(right.ownMemberNumber) &&
        left.members.length === right.members.length &&
        left.members.every((member, index) => {
            const other = right.members[index];
            return (
                member.memberNumber === other.memberNumber &&
                member.publicKey === other.publicKey &&
                member.name === other.name
            );
        })
    );
}

/** What the user answered to a group invite; `dismiss` asks again when the inviter replays it. */
export type GroupInviteDecision = 'accept' | 'decline' | 'block' | 'dismiss';

export type BlockedLocator = {
    publicKey: string;
    serverUrl?: string;
    blockedAt: number;
};

export type EphemonHookConversations = {
    available: Array<EphemonHookConversation>;
    create: (publicKey: string, serverUrl?: string) => ConversationId | undefined;
    createGroup: (
        members: ReadonlyArray<{ publicKey: string; serverUrl?: string }>,
        name?: string,
        ownName?: string,
    ) => Promise<ConversationId>;
    blocked: {
        list: ReadonlyArray<BlockedLocator>;
        isBlocked: (publicKey: string) => boolean;
        block: (publicKey: string, serverUrl?: string) => void;
        unblock: (publicKey: string) => void;
    };
    callbacks: EphemonHookConnectionCallbacks;
};

type EphemonHook = [string | undefined, EphemonHookMetadata, EphemonHookConversations];

function isSelfChatConnection(connection: Connection): boolean {
    return connection.publicKey === requireEphemonCore().publicKey;
}

function inviteSessionKey(id: ConversationId, peerPublicKey: string): string {
    return `${id}:${peerPublicKey}`;
}

const RELAY_HOPS = 4;
const HISTORY_BATCH_BYTES = 48 * 1024;
const DEFERRED_PAYLOAD_LIMIT = 63;
const CATCH_UP_WINDOW_MS = 500;
const GROUP_FALLBACK_NAME = 'Group';
const SEEN_PAYLOAD_LIMIT = 512;

async function payloadKey(payload: Uint8Array): Promise<string> {
    return routingKey(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(payload))));
}

function routingKey(routingId: Uint8Array | ReadonlyArray<number>): string {
    return Array.from(routingId, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function frontierRoster(ready: DirectMlsBootstrapResult): ReadonlyArray<MemberNumber> {
    return ready.membership.roster.length > 0
        ? ready.membership.roster.map((member) => member.memberNumber)
        : [ready.membership.ownMemberNumber];
}

function observedHybridLogicalTime(id: ConversationId): HybridLogicalTime | undefined {
    return getChatStore(id).getObservedTime();
}

function joinedEpochByLocator(ready: DirectMlsBootstrapResult): Map<string, bigint> {
    return new Map(
        ready.membership.roster
            .filter((member) => member.publicKey.length > 0)
            .map((member) => [
                member.publicKey,
                member.joinedEpoch === undefined ? ready.epoch : BigInt(member.joinedEpoch),
            ]),
    );
}

function readableLinks(
    links: ReadonlyArray<Connection>,
    joinedByLocator: Map<string, bigint>,
    authored: bigint | undefined,
): Array<Connection> {
    if (authored === undefined) return [...links];
    return links.filter((connection) => {
        const joined = joinedByLocator.get(connection.publicKey);
        return joined === undefined || joined <= authored;
    });
}

export function useEphemon(
    passwordState: EphemonHookMetadataPasswordState,
    onPermissionDefault: () => Promise<void>,
    onPermissionGranted: () => Promise<void>,
    onPermissionDenied: () => Promise<void>,
    focusOnDial: (publicKey: string) => Promise<boolean>,
    requestDial: (publicKey: string, alreadyExists: boolean) => Promise<boolean>,
    onIncomingConnection: (connection: Connection) => void,
    onConnectionStateChanged: (
        conversationId: ConversationId,
        connection: Connection,
        from: ConnectionState,
        to: ConnectionState,
    ) => void,
    onConnectionTransportChanged: (
        conversationId: ConversationId,
        connection: Connection,
        transport: ConnectionTransport,
    ) => void,
    onConnectionError: (conversationId: ConversationId, connection: Connection, error: ConnectionError) => void,
    requestGroupInvite: (inviterPublicKey: string, groupName: string) => Promise<GroupInviteDecision>,
): EphemonHook {
    const [publicKey, setPublicKey] = useState<string | undefined>();

    const [writer, setWriter] = useState(!isWriterLockSupported());
    const writerRef = useRef(writer);
    writerRef.current = writer;

    useEffect(() => acquireWriterLock(() => setWriter(true)), []);

    const logger = getLogger();

    const ephemonPrototype = useMemo<EphemonPrototype>(() => getPrototype(logger), [logger]);

    type DB_KEYS_TYPE = [number[], number[]];
    type DB_CONNECTIONS_TYPE = {
        kind?: 'direct' | 'group';
        publicKey: string;
        order: number;
        name: string | undefined;
        namedByUser?: boolean;
        serverUrl: string | undefined;
        clearedFrontier?: StoredClearedFrontier;
        mlsBootstrap?: StoredMlsBootstrap;
    };
    const clearedFrontiersRef = useRef<Map<ConversationId, StoredClearedFrontier>>(new Map());
    const mlsBootstrapsRef = useRef<Map<ConversationId, StoredMlsBootstrap>>(new Map());
    const database = getVault();
    const unlocked = passwordState === 'valid' && database.isUnlocked();

    const [signingKeyPair, setSigningKeyPair] = useState<
        { publicKey: Uint8Array; secretKey: Uint8Array } | undefined
    >();

    const signingKeyPairGenerated = useRef(false);

    useEffect(() => {
        if (unlocked && !signingKeyPair && ephemonPrototype) {
            database
                .get<DB_KEYS_TYPE>(DB_SLUG_TABLE_KEYS, 'signing')
                .then(async (keyPair) => {
                    const [pub, sec] = keyPair || [];
                    if (pub === undefined || pub === null || sec === undefined || sec === null) {
                        if (signingKeyPairGenerated.current) {
                            return;
                        }
                        signingKeyPairGenerated.current = true;
                        const keyPair = ephemonPrototype.generateSigningKeyPair();
                        await database.set<DB_KEYS_TYPE>(DB_SLUG_TABLE_KEYS, 'signing', [
                            Array.from(keyPair.publicKey),
                            Array.from(keyPair.secretKey),
                        ]);
                        return keyPair;
                    } else {
                        return {
                            publicKey: Uint8Array.from(pub),
                            secretKey: Uint8Array.from(sec),
                        };
                    }
                })
                .then((keyPair) => setSigningKeyPair(keyPair));
        }
    }, [unlocked, database, signingKeyPair, ephemonPrototype]);

    const getStoredConnections = useCallback(async (): Promise<
        Array<{
            id: ConversationId;
            kind: 'direct' | 'group';
            publicKey: string;
            name: string | undefined;
            namedByUser?: boolean;
            serverUrl: string | undefined;
            order: number;
            clearedFrontier?: StoredClearedFrontier;
            mlsBootstrap?: StoredMlsBootstrap;
        }>
    > => {
        if (unlocked) {
            const connections = await database.getAll<DB_CONNECTIONS_TYPE>(DB_SLUG_TABLE_CONNECTIONS);
            return connections.map((connection) => ({
                id: toConversationId(Number(connection.id)),
                kind: connection.value.kind === 'group' ? ('group' as const) : ('direct' as const),
                publicKey: connection.value.publicKey,
                name: connection.value.name,
                namedByUser: connection.value.namedByUser,
                serverUrl: connection.value.serverUrl,
                order: connection.value.order,
                clearedFrontier: connection.value.clearedFrontier,
                mlsBootstrap: connection.value.mlsBootstrap,
            }));
        }
        return [];
    }, [unlocked, database]);

    const upsertStoredConnection = useCallback(
        async (connection: EphemonHookConversation) => {
            const data = {
                kind: connection.kind,
                namedByUser: connection.namedByUser,
                publicKey: connection.publicKey,
                name: connection.name,
                serverUrl: connection.serverUrl,
                order: getConversationOrder(connection.id),
                clearedFrontier: clearedFrontiersRef.current.get(connection.id),
                mlsBootstrap: mlsBootstrapsRef.current.get(connection.id),
            };
            if (unlocked && writerRef.current) {
                await database.set<DB_CONNECTIONS_TYPE>(DB_SLUG_TABLE_CONNECTIONS, connection.id, data);
            }
        },
        [unlocked, database],
    );

    const [blocked, setBlocked] = useState<ReadonlyArray<BlockedLocator>>([]);
    const blockedRef = useRef<ReadonlyArray<BlockedLocator>>(blocked);
    blockedRef.current = blocked;

    const revokeBlockedTransport = useCallback((publicKey: string): void => {
        if (publicKey.length === 0) return;
        transportsRef.current.forgetPeer(publicKey);
        for (const [id, connection] of connectionsRef.current ?? []) {
            if (connection.publicKey === publicKey) connectionsRef.current?.delete(id);
        }
        if (hasEphemonCore()) requireEphemonCore().delete(publicKey);
    }, []);

    useEffect(() => {
        if (!unlocked) {
            setBlocked([]);
            return;
        }
        database
            .getAll<BlockedLocator>(DB_SLUG_TABLE_BLOCKED)
            .then((rows) => {
                const stored = rows.map((row) => row.value);
                blockedRef.current = stored;
                setBlocked(stored);
                for (const entry of stored) revokeBlockedTransport(entry.publicKey);
            })
            .catch(() => setBlocked([]));
    }, [unlocked, database, revokeBlockedTransport]);

    const isBlocked = useCallback(
        (publicKey: string): boolean => blockedRef.current.some((entry) => entry.publicKey === publicKey),
        [],
    );

    const blockLocator = useCallback(
        (publicKey: string, serverUrl?: string): void => {
            if (publicKey.length === 0 || isBlocked(publicKey)) return;
            const entry: BlockedLocator = { publicKey, serverUrl, blockedAt: now() };
            blockedRef.current = [...blockedRef.current, entry];
            setBlocked((previous) => [...previous, entry]);
            revokeBlockedTransport(publicKey);
            database.set<BlockedLocator>(DB_SLUG_TABLE_BLOCKED, publicKey, entry).catch(logger.error);
        },
        [database, isBlocked, logger, revokeBlockedTransport],
    );

    const unblockLocator = useCallback(
        (publicKey: string): void => {
            blockedRef.current = blockedRef.current.filter((entry) => entry.publicKey !== publicKey);
            setBlocked((previous) => previous.filter((entry) => entry.publicKey !== publicKey));
            database.delete(DB_SLUG_TABLE_BLOCKED, publicKey).catch(logger.error);
        },
        [database, logger],
    );

    const [conversations, setConversations] = useState<Array<EphemonHookConversation>>([]);
    const connectionsRef = useRef<Map<ConversationId, Connection> | undefined>(undefined);
    const transportsRef = useRef<TransportRegistry>(createTransportRegistry());
    const conversationListRef = useRef<Array<EphemonHookConversation>>(conversations);
    conversationListRef.current = conversations;

    type ConnectionEventHandlers = {
        onProgress?: (progress: number) => void;
        onStateChanged?: (from: ConnectionState, to: ConnectionState) => void;
        onEvent?: (event: InboundChatEvent) => void;
    };
    const sessionsRef = useRef<ConversationSessions>(createConversationSessions());
    const eventHandlersRef = useRef<Map<ConversationId, ConnectionEventHandlers>>(new Map());
    const explicitPeerCloseRef = useRef<(id: ConversationId) => void>(() => {});
    const mlsWorkerClientRef = useRef<MlsWorkerClient | undefined>(undefined);

    useEffect(() => {
        const disposeMls = (): void => {
            sessionsRef.current.forgetMlsState();
            mlsWorkerClientRef.current?.close();
            mlsWorkerClientRef.current = undefined;
        };
        if (!unlocked) {
            disposeMls();
            return;
        }
        return disposeMls;
    }, [unlocked]);

    const runExclusiveCommit = useCallback(<T>(id: ConversationId, task: () => Promise<T>): Promise<T> => {
        const previous = sessionsRef.current.commitQueue.get(id) ?? Promise.resolve();
        const next = previous.then(task, task);
        sessionsRef.current.commitQueue.set(
            id,
            next.catch(() => undefined),
        );
        return next;
    }, []);

    const groupNameFor = useCallback((roster: ReadonlyArray<{ publicKey: string; name?: string }>): string => {
        const ownPublicKey = requireEphemonCore().publicKey;
        const named = roster
            .filter((member) => member.publicKey !== ownPublicKey)
            .map((member) => {
                if (member.name !== undefined && member.name.length > 0) return member.name;
                const known = conversationListRef.current.find(
                    (candidate) => candidate.kind === 'direct' && candidate.publicKey === member.publicKey,
                );
                return known?.name ?? '';
            })
            .filter((entry) => entry.length > 0);
        return named.length === 0 ? GROUP_FALLBACK_NAME : named.join(', ');
    }, []);

    const bootstrapOf = useCallback((id: ConversationId): StoredMlsBootstrap | undefined => {
        return mlsBootstrapsRef.current.get(id);
    }, []);

    const rosterOf = useCallback((id: ConversationId): ReadonlyArray<MlsRosterMember> => {
        return rosterFrom(mlsBootstrapsRef.current.get(id)?.roster);
    }, []);

    const registerRouting = useCallback((id: ConversationId, routingId: Uint8Array | ReadonlyArray<number>): void => {
        sessionsRef.current.routes.set(routingKey(routingId), id);
    }, []);

    const conversationsOnTransport = useCallback((peerPublicKey: string): Array<ConversationId> => {
        return transportsRef.current.conversationsOn(peerPublicKey);
    }, []);

    const directConversationOf = useCallback((peerPublicKey: string): ConversationId | undefined => {
        return conversationListRef.current.find(
            (candidate) => candidate.kind === 'direct' && candidate.publicKey === peerPublicKey,
        )?.id;
    }, []);

    const getMlsWorkerClient = useCallback((): MlsWorkerClient => {
        if (!database.isUnlocked()) throw new Error('Cannot start MLS while the vault is locked');
        const existing = mlsWorkerClientRef.current;
        if (existing !== undefined) return existing;
        const created = new MlsWorkerClient(createVaultMlsCheckpointStore(database));
        mlsWorkerClientRef.current = created;
        return created;
    }, [database]);

    const membershipFor = useCallback((id: ConversationId, connection: Connection): DirectMlsMembership => {
        const ready = sessionsRef.current.ready.get(id);
        if (ready !== undefined) return ready.membership;
        const stored = mlsBootstrapsRef.current.get(id);
        if (stored !== undefined && stored.roster !== undefined && stored.roster.length > 0) {
            return membershipFrom(stored);
        }
        const ownPublicKey = requireEphemonCore().publicKey;
        if (ownPublicKey === undefined) throw new Error('Cannot elect direct MLS members before login completes');
        return assignDirectMlsMembership(ownPublicKey, connection.publicKey, connection.serverUrl);
    }, []);

    const patchConversation = useCallback(
        (id: ConversationId, patch: (conversation: EphemonHookConversation) => EphemonHookConversation): void => {
            const previous = conversationListRef.current;
            const existing = previous.find((conversation) => conversation.id === id);
            if (existing === undefined) return;
            const patched = patch(existing);
            if (sameConversation(existing, patched)) return;
            const next = previous.map((conversation) => (conversation.id === id ? patched : conversation));
            conversationListRef.current = next;
            setConversations(next);
            upsertStoredConnection(patched).catch(logger.error);
        },
        [logger, upsertStoredConnection],
    );

    const persistMlsRoster = useCallback(
        (id: ConversationId, membership: DirectMlsMembership, epoch: bigint, routingId: Uint8Array): void => {
            const bootstrap = {
                version: 1 as const,
                routingId: Array.from(routingId),
                epoch: epoch.toString(),
                owner: membership.owner,
                ownMemberNumber: membership.ownMemberNumber,
                roster: membership.roster.map((member) => ({
                    memberNumber: Number(member.memberNumber),
                    publicKey: member.publicKey,
                    serverUrl: member.serverUrl,
                    joinedEpoch: member.joinedEpoch,
                    name: member.name,
                })),
            };
            const held = mlsBootstrapsRef.current.get(id);
            if (held !== undefined && JSON.stringify(held) === JSON.stringify(bootstrap)) return;
            mlsBootstrapsRef.current.set(id, bootstrap);
            const conversation = conversationListRef.current.find((candidate) => candidate.id === id);
            if (conversation === undefined) return;
            // Only a group shows its membership; a direct conversation's is protocol state and nothing renders it.
            if (conversation.kind === 'group') {
                const presentation = groupPresentationOf(bootstrap);
                patchConversation(id, (previous) =>
                    sameGroupPresentation(previous.group, presentation)
                        ? previous
                        : { ...previous, group: presentation },
                );
            }
            upsertStoredConnection(
                conversationListRef.current.find((candidate) => candidate.id === id) ?? conversation,
            ).catch(logger.error);
        },
        [logger, patchConversation, upsertStoredConnection],
    );

    const renameGroupFromRoster = useCallback(
        (id: ConversationId, roster: ReadonlyArray<{ publicKey: string }>): void => {
            const conversation = conversationListRef.current.find((candidate) => candidate.id === id);
            if (conversation?.kind !== 'group' || conversation.namedByUser === true) return;
            const name = groupNameFor(roster);
            patchConversation(id, (previous) => ({ ...previous, name }));
        },
        [groupNameFor, patchConversation],
    );

    const startDirectMlsBootstrap = useCallback(
        async (id: ConversationId, connection: Connection): Promise<DirectMlsBootstrapSession> => {
            const peers = sessionsRef.current.bootstraps.get(id) ?? new Map<string, DirectMlsBootstrapSession>();
            sessionsRef.current.bootstraps.set(id, peers);
            let session = peers.get(connection.publicKey);
            if (session === undefined) {
                session = new DirectMlsBootstrapSession({
                    conversationId: id,
                    membership: membershipFor(id, connection),
                    mls: getMlsWorkerClient(),
                    send: (frame) => {
                        if (
                            connection.state === ConnectionState.Open ||
                            connection.state === ConnectionState.Degraded
                        ) {
                            connection.send(frame);
                        }
                    },
                    onComplete: (result) => {
                        const { routingId, epoch, membership } = result;
                        sessionsRef.current.markReady(id, result);
                        registerRouting(id, routingId);
                        logger.debug(
                            `[mls] Direct conversation ${id} bootstrapped at epoch ${epoch} as member ${membership.ownMemberNumber}.`,
                        );
                        persistMlsRoster(id, membership, epoch, routingId);
                    },
                });
                peers.set(connection.publicKey, session);
            }
            await session.start();
            return session;
        },
        [getMlsWorkerClient, logger, membershipFor, persistMlsRoster, registerRouting],
    );

    const ownCommitHead = useCallback(
        async (id: ConversationId): Promise<CommitHead | undefined> => {
            const inspection = await getMlsWorkerClient().inspect(id);
            if (inspection.epoch === undefined || inspection.epochAuthenticator === undefined) return undefined;
            return { epoch: inspection.epoch, authenticator: inspection.epochAuthenticator };
        },
        [getMlsWorkerClient],
    );

    const recordCommit = useCallback(
        async (id: ConversationId, commit: Uint8Array, known?: CommitHead): Promise<void> => {
            const head = known ?? (await ownCommitHead(id));
            if (head === undefined) return;
            await database.appendMlsCommit(id, {
                epoch: head.epoch.toString(),
                authenticator: Uint8Array.from(head.authenticator),
                commit: Uint8Array.from(commit),
            });
        },
        [database, ownCommitHead],
    );

    const restoreGroupMlsOnce = useCallback(
        async (id: ConversationId): Promise<DirectMlsBootstrapResult | undefined> => {
            const conversation = conversationListRef.current.find((candidate) => candidate.id === id);
            const bootstrap = conversation?.kind === 'group' ? mlsBootstrapsRef.current.get(id) : undefined;
            if (bootstrap === undefined) return undefined;
            const mls = getMlsWorkerClient();
            await mls.initialize(id, bootstrap.ownMemberNumber);
            const epoch = (await mls.inspect(id)).epoch ?? BigInt(bootstrap.epoch);
            const restored: DirectMlsBootstrapResult = {
                routingId: Uint8Array.from(bootstrap.routingId),
                epoch,
                membership: membershipFrom(bootstrap),
            };
            sessionsRef.current.markReady(id, restored);
            registerRouting(id, restored.routingId);
            // A rekey advances the epoch for everyone, and the commit log keeps only the newest entries, so one that
            // reaches nobody spends a member's way back into the chain for nothing.
            if (
                Number(bootstrap.ownMemberNumber) === Number(bootstrap.owner) &&
                transportsRef.current.usable(id).length > 0
            ) {
                const rekey = runExclusiveCommit(id, async () => {
                    const commit = await mls.createSelfUpdate(id);
                    await mls.mergePendingCommit(id);
                    const merged = await mls.inspect(id);
                    const head = merged.epoch ?? epoch;
                    restored.epoch = head;
                    sessionsRef.current.ready.set(id, restored);
                    if (merged.epochAuthenticator !== undefined) {
                        await recordCommit(id, commit, { epoch: head, authenticator: merged.epochAuthenticator });
                    }
                    const frame = encodeDirectMlsWireFrame({ kind: 'commit', routingId: restored.routingId, commit });
                    for (const transport of transportsRef.current.usable(id)) {
                        transport.send(frame);
                    }
                });
                const attempted = rekey.catch((error) => {
                    logger.error(`[mls] Conversation ${id} could not rekey on restore.`, error);
                });
                sessionsRef.current.rekeys.set(id, attempted);
                await attempted;
                if (sessionsRef.current.rekeys.get(id) === attempted) sessionsRef.current.rekeys.delete(id);
            }
            return restored;
        },
        [getMlsWorkerClient, logger, recordCommit, registerRouting, runExclusiveCommit],
    );

    const restoreGroupMls = useCallback(
        (id: ConversationId): Promise<DirectMlsBootstrapResult | undefined> => {
            const running = sessionsRef.current.restores.get(id);
            if (running !== undefined) return running;
            const restoring = restoreGroupMlsOnce(id).finally(() => {
                if (sessionsRef.current.restores.get(id) === restoring) sessionsRef.current.restores.delete(id);
            });
            sessionsRef.current.restores.set(id, restoring);
            return restoring;
        },
        [restoreGroupMlsOnce],
    );

    const waitForDirectMls = useCallback(
        async (id: ConversationId, connection: Connection): Promise<DirectMlsBootstrapResult> => {
            const ready = sessionsRef.current.ready.get(id);
            if (ready !== undefined) return ready;
            const restored = await restoreGroupMls(id);
            if (restored !== undefined) return restored;
            const joining = sessionsRef.current.inviteJoiners.has(id);
            const group = conversationListRef.current.find((candidate) => candidate.id === id)?.kind === 'group';
            if (group && !joining) {
                throw new Error('MLS group conversation has no session and no join in flight');
            }
            const completion = new Promise<DirectMlsBootstrapResult>((resolve, reject) => {
                let waiters = sessionsRef.current.readyWaiters.get(id);
                if (waiters === undefined) {
                    waiters = new Set();
                    sessionsRef.current.readyWaiters.set(id, waiters);
                }
                waiters.add({ resolve, reject });
            });
            if (!joining) {
                /** A fresh session already greets the peer in `start()`; only an existing one needs the nudge. */
                const existing = sessionsRef.current.bootstraps.get(id)?.has(connection.publicKey) === true;
                const session = await startDirectMlsBootstrap(id, connection);
                if (
                    existing &&
                    (connection.state === ConnectionState.Open || connection.state === ConnectionState.Degraded)
                ) {
                    await session.linkOpened();
                }
            }
            return sessionsRef.current.ready.get(id) ?? completion;
        },
        [restoreGroupMls, startDirectMlsBootstrap],
    );

    const applyCommitOrDrop = useCallback(
        async (id: ConversationId, commit: Uint8Array, ready: DirectMlsBootstrapResult) => {
            const present = ready.membership.roster.map((member) => Number(member.memberNumber));
            try {
                return await getMlsWorkerClient().processIncomingCommit(id, commit, (facts) => {
                    if (!facts.senderIsMember) return 'the sender is not an authenticated group member';
                    if (Number(facts.senderMemberNumber) !== Number(ready.membership.owner)) {
                        return `member ${facts.senderMemberNumber} is not the owner of this conversation`;
                    }
                    const clash = facts.added.find((member) => present.includes(Number(member)));
                    return clash === undefined ? undefined : `member ${clash} is already in the group`;
                });
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                if (error instanceof MlsCommitRefusedError)
                    logger.error(`[mls] Conversation ${id} refused a commit: ${reason}`);
                else logger.debug(`[mls] Conversation ${id} ignored a commit it cannot apply: ${reason}`);
                return undefined;
            }
        },
        [getMlsWorkerClient, logger],
    );

    const markPayloadSeen = useCallback(async (id: ConversationId, payload: Uint8Array): Promise<boolean> => {
        const seen = sessionsRef.current.seenPayloads.get(id) ?? new Set<string>();
        sessionsRef.current.seenPayloads.set(id, seen);
        const key = await payloadKey(payload);
        if (seen.has(key)) return false;
        if (seen.size >= SEEN_PAYLOAD_LIMIT) seen.delete(seen.values().next().value as string);
        seen.add(key);
        return true;
    }, []);

    const registerTransport = useCallback((id: ConversationId, connection: Connection): void => {
        transportsRef.current.register(id, connection);
    }, []);

    const replaceTransport = useCallback((connection: Connection): Array<ConversationId> => {
        return transportsRef.current.replace(connection);
    }, []);

    const usableTransports = useCallback((id: ConversationId): Array<Connection> => {
        return transportsRef.current.usable(id);
    }, []);

    const transportsOf = useCallback((id: ConversationId, publicKey: string | undefined): Array<Connection> => {
        const usable = transportsRef.current.usable(id);
        if (publicKey === undefined || publicKey.length === 0) return usable;
        const direct = usable.filter((connection) => connection.publicKey === publicKey);
        return direct.length > 0 ? direct : usable;
    }, []);

    const sendCommitFrame = useCallback(
        async (id: ConversationId, routingId: Uint8Array, commit: Uint8Array): Promise<void> => {
            const frame = encodeDirectMlsWireFrame({ kind: 'commit', routingId, commit });
            for (const connection of usableTransports(id)) {
                connection.send(frame);
            }
        },
        [usableTransports],
    );

    const emitMlsEvent = useCallback(
        async (
            id: ConversationId,
            routingId: Uint8Array,
            bytes: Uint8Array,
            chain?: ChatChainState,
            to?: ReadonlyArray<Connection>,
        ): Promise<void> => {
            const encrypted = await getMlsWorkerClient().createApplicationMessage(
                id,
                bytes,
                chain === undefined ? undefined : encodeChatChainState(chain),
            );
            const frame = encodeDirectMlsWireFrame({ kind: 'application', routingId, message: encrypted });
            await markPayloadSeen(id, encrypted);
            for (const connection of to ?? usableTransports(id)) {
                connection.send(frame);
            }
        },
        [getMlsWorkerClient, markPayloadSeen, usableTransports],
    );

    /**
     * Encrypting an event mutates the group, so it cannot run while a commit is staged. Callers that already hold the
     * commit queue use `emitMlsEvent` directly; everyone else goes through here.
     */
    const sendMlsEventBytes = useCallback(
        (
            id: ConversationId,
            routingId: Uint8Array,
            bytes: Uint8Array,
            chain?: ChatChainState,
            to?: ReadonlyArray<Connection>,
        ): Promise<void> => runExclusiveCommit(id, () => emitMlsEvent(id, routingId, bytes, chain, to)),
        [emitMlsEvent, runExclusiveCommit],
    );

    const relayPayload = useCallback(
        (id: ConversationId, routingId: Uint8Array, payload: Uint8Array, hops: number, from?: string): void => {
            if (hops <= 0) return;
            if (conversationListRef.current.find((candidate) => candidate.id === id)?.kind !== 'group') return;
            const frame = encodeDirectMlsWireFrame({ kind: 'relay', routingId, hops: hops - 1, message: payload });
            for (const connection of usableTransports(id)) {
                if (connection.publicKey === from) continue;
                connection.send(frame);
            }
        },
        [usableTransports],
    );

    const clearedFrontierOf = useCallback((id: ConversationId): ChatClearedFrontier => {
        const stored = clearedFrontiersRef.current.get(id) ?? [];
        return stored.map((entry) => ({ author: toMemberNumber(entry.author), through: entry.through }));
    }, []);

    const sendInventory = useCallback(
        async (
            id: ConversationId,
            ready: DirectMlsBootstrapResult,
            records: ReadonlyArray<ChatEventRecord>,
            reply = false,
        ) => {
            const cleared = clearedFrontierOf(id);
            const roster = frontierRoster(ready);
            const stored = getMlsWorkerClient().getCheckpointChain(id);
            const authored = stored === undefined ? 0 : decodeChatChainState(stored).sequence;
            const bytes = await authorInventoryEvent(
                {
                    head: await ownCommitHead(id),
                    frontier: clampOwnAuthorFrontier(
                        computeChatFrontier(records, cleared, roster),
                        ready.membership.ownMemberNumber,
                        authored,
                    ),
                },
                reply,
                observedHybridLogicalTime(id),
                serverTime(),
            );
            await sendMlsEventBytes(id, ready.routingId, bytes);
        },
        [clearedFrontierOf, getMlsWorkerClient, ownCommitHead, sendMlsEventBytes],
    );

    const sendProfile = useCallback(
        async (id: ConversationId, ready: DirectMlsBootstrapResult): Promise<void> => {
            const ownPublicKey = requireEphemonCore().publicKey;
            if (ownPublicKey === undefined) return;
            const own = ready.membership.roster.find((member) => member.publicKey === ownPublicKey);
            if (own?.name === undefined || own.name.length === 0) return;
            const bytes = await authorProfileEvent(
                own.name,
                ownPublicKey,
                getSettings().serverUrl,
                observedHybridLogicalTime(id),
                serverTime(),
            );
            await sendMlsEventBytes(id, ready.routingId, bytes);
        },
        [sendMlsEventBytes],
    );

    const absorbProfile = useCallback(
        (id: ConversationId, author: MemberNumber, name: string, locator: string, serverUrl?: string): void => {
            const ready = sessionsRef.current.ready.get(id);
            const current = ready?.membership.roster ?? rosterOf(id);
            const known = current.some((member) => Number(member.memberNumber) === Number(author));
            const claimable = locator.length > 0 && !current.some((member) => member.publicKey === locator);
            const roster = (
                known
                    ? current
                    : [
                          ...current,
                          {
                              memberNumber: author,
                              publicKey: claimable ? locator : '',
                              serverUrl,
                              joinedEpoch: ready?.epoch.toString(),
                          },
                      ]
            ).map((member) => {
                if (Number(member.memberNumber) !== Number(author)) return member;
                if (member.publicKey.length > 0) return { ...member, name };
                if (!claimable) return { ...member, name };
                return { ...member, name, publicKey: locator, serverUrl: serverUrl ?? member.serverUrl };
            });
            roster.sort((left, right) => Number(left.memberNumber) - Number(right.memberNumber));
            if (ready !== undefined) {
                const membership = { ...ready.membership, roster };
                sessionsRef.current.ready.set(id, { ...ready, membership });
                persistMlsRoster(id, membership, ready.epoch, ready.routingId);
            }
            renameGroupFromRoster(id, roster);
        },
        [persistMlsRoster, renameGroupFromRoster, rosterOf],
    );

    const serveCommits = useCallback(
        async (id: ConversationId, ready: DirectMlsBootstrapResult, peer: ChatInventory) => {
            const own = await ownCommitHead(id);
            if (own === undefined || peer.head === undefined) return true;
            const relation = relateHeads(own, peer.head);
            if (relation === 'fork') {
                logger.error(`[mls] Conversation ${id} diverged at epoch ${own.epoch}; catch-up cannot continue.`);
                setConnectionNotice(id, { code: 'sync-failed' });
                return false;
            }
            if (relation !== 'ahead') return true;
            for (const commit of commitsAfter(await database.getMlsCommits(id), peer.head.epoch)) {
                await sendCommitFrame(id, ready.routingId, commit.commit);
            }
            return true;
        },
        [database, logger, ownCommitHead, sendCommitFrame],
    );

    const serveInventory = useCallback(
        async (id: ConversationId, ready: DirectMlsBootstrapResult, peer: ChatInventory, asker: MemberNumber) => {
            if (!(await serveCommits(id, ready, peer))) return;
            const { frontier } = peer;
            const records = getChatStore(id).getRecords();
            const wanted = missingForPeer(
                frontier,
                computeChatFrontier(records, clearedFrontierOf(id), frontierRoster(ready)),
            );
            if (wanted.length === 0) return;
            const asking = ready.membership.roster.find((member) => Number(member.memberNumber) === Number(asker));
            const joinedEpoch = asking?.joinedEpoch === undefined ? ready.epoch : BigInt(asking.joinedEpoch);
            const to = transportsOf(id, asking?.publicKey);
            if (to.length === 0) return;
            const joinedByLocator = joinedEpochByLocator(ready);
            const batches = new Map<
                string,
                { links: ReadonlyArray<Connection>; chunks: Array<Array<Uint8Array>>; size: number }
            >();
            for (const record of records) {
                if (record.author === undefined || record.sequence === undefined) continue;
                const authored = record.epoch === undefined ? undefined : BigInt(record.epoch);
                if (authored !== undefined && authored < joinedEpoch) {
                    continue;
                }
                const sequence = record.sequence;
                const author = record.author;
                if (
                    !wanted.some((range) => range.author === author && sequence >= range.from && sequence <= range.to)
                ) {
                    continue;
                }
                const bytes = storedChatEventBytes(record);
                if (bytes === undefined) continue;
                const links = readableLinks(to, joinedByLocator, authored);
                if (links.length === 0) continue;
                const key = links.map((link) => link.publicKey).join(',');
                const batch = batches.get(key) ?? { links, chunks: [[]], size: 0 };
                if (batch.size + bytes.byteLength > HISTORY_BATCH_BYTES && batch.chunks.at(-1)!.length > 0) {
                    batch.chunks.push([]);
                    batch.size = 0;
                }
                batch.chunks.at(-1)!.push(bytes);
                batch.size += bytes.byteLength;
                batches.set(key, batch);
            }
            for (const { links, chunks } of batches.values()) {
                for (const frames of chunks) {
                    if (frames.length === 0) continue;
                    const bytes = await authorHistoryBatch(frames, observedHybridLogicalTime(id), serverTime());
                    await sendMlsEventBytes(id, ready.routingId, bytes, undefined, links);
                }
            }
        },
        [clearedFrontierOf, sendMlsEventBytes, serveCommits, transportsOf],
    );

    const nextConversationId = useCallback((): ConversationId => {
        const used = [
            ...(connectionsRef.current?.keys() ?? []),
            ...conversationListRef.current.map((conversation) => conversation.id),
        ];
        return toConversationId(used.length > 0 ? Math.max(...used) + 1 : 0);
    }, []);

    const createGroupConversation = useCallback(
        (routingId: Uint8Array, name?: string): ConversationId => {
            const id = nextConversationId();
            setConversationOrder(id, now());
            registerRouting(id, routingId);
            const conversation: EphemonHookConversation = {
                id,
                kind: 'group',
                publicKey: '',
                name,
                serverUrl: undefined,
            };
            conversationListRef.current = [
                ...conversationListRef.current.filter((candidate) => candidate.id !== id),
                conversation,
            ].sort((a, b) => a.id - b.id);
            setConversations(conversationListRef.current);
            upsertStoredConnection(conversation).catch(logger.error);
            return id;
        },
        [logger, nextConversationId, registerRouting, upsertStoredConnection],
    );

    const reconcileGroup = useCallback(
        async (id: ConversationId): Promise<void> => {
            if (conversationListRef.current.find((candidate) => candidate.id === id)?.kind !== 'group') return;
            const ready = sessionsRef.current.ready.get(id) ?? (await restoreGroupMls(id));
            if (ready === undefined || usableTransports(id).length === 0) return;
            if (!hasOwnGroupName(ready)) return;
            await sendProfile(id, ready);
            await sendInventory(id, ready, getChatStore(id).getRecords());
        },
        [restoreGroupMls, sendInventory, sendProfile, usableTransports],
    );

    const runReconcile = useCallback(
        (id: ConversationId): Promise<void> => {
            const sessions = sessionsRef.current;
            const started = reconcileGroup(id).then(
                () => setConnectionNotice(id, undefined),
                (error: unknown) => {
                    // A catch-up failure leaves the link open, so nothing else in the UI would ever mention it.
                    setConnectionNotice(id, { code: 'sync-failed' });
                    throw error;
                },
            );
            const settled = started.catch(() => undefined);
            sessions.reconciles.set(id, settled);
            void settled.then(() => {
                if (sessions.reconciles.get(id) === settled) sessions.reconciles.delete(id);
            });
            return started;
        },
        [reconcileGroup],
    );

    /** Transport churn collapses into the pass in flight plus at most one more, not one pass per event. */
    const reconcile = useCallback(
        (id: ConversationId): Promise<void> => {
            const sessions = sessionsRef.current;
            const queued = sessions.queuedReconciles.get(id);
            if (queued !== undefined) return queued;
            const running = sessions.reconciles.get(id);
            if (running === undefined) return runReconcile(id);
            const next = running.then(() => {
                if (sessions.queuedReconciles.get(id) === next) sessions.queuedReconciles.delete(id);
                return runReconcile(id);
            });
            sessions.queuedReconciles.set(id, next);
            void next.catch(() => undefined);
            return next;
        },
        [runReconcile],
    );

    const setGroupMemberName = useCallback(
        (id: ConversationId, name: string): void => {
            const ownPublicKey = requireEphemonCore().publicKey;
            if (ownPublicKey === undefined || !writerRef.current) return;
            const ready = sessionsRef.current.ready.get(id);
            const current = ready?.membership.roster ?? rosterOf(id);
            const roster = current.map((member) => (member.publicKey === ownPublicKey ? { ...member, name } : member));
            if (ready !== undefined) {
                const membership = { ...ready.membership, roster };
                sessionsRef.current.ready.set(id, { ...ready, membership });
                persistMlsRoster(id, membership, ready.epoch, ready.routingId);
                sendProfile(id, { ...ready, membership }).catch(logger.error);
                return;
            }
            const stored = mlsBootstrapsRef.current.get(id);
            if (stored === undefined) return;
            const membership = membershipFrom(stored, roster);
            persistMlsRoster(id, membership, BigInt(stored.epoch), Uint8Array.from(stored.routingId));
            reconcile(id).catch(logger.error);
        },
        [logger, persistMlsRoster, reconcile, rosterOf, sendProfile],
    );

    const requestCatchUp = useCallback(
        async (id: ConversationId, ready: DirectMlsBootstrapResult): Promise<void> => {
            const asked = sessionsRef.current.catchUpAsked.get(id) ?? 0;
            const moment = now();
            if (moment - asked < CATCH_UP_WINDOW_MS) return;
            sessionsRef.current.catchUpAsked.set(id, moment);
            const wanted = encodeDirectMlsWireFrame({
                kind: 'commitsWanted',
                routingId: ready.routingId,
                epoch: ready.epoch,
            });
            for (const connection of usableTransports(id)) connection.send(wanted);
            await sendInventory(id, ready, getChatStore(id).getRecords());
        },
        [sendInventory, usableTransports],
    );

    const deliverApplication = useCallback(
        async (id: ConversationId, ready: DirectMlsBootstrapResult, ciphertext: Uint8Array): Promise<void> => {
            let processed;
            try {
                processed = await getMlsWorkerClient().processApplicationMessage(id, ciphertext);
            } catch (error) {
                const code = mlsErrorCode(error);
                if (code === 'unableToDecrypt') {
                    logger.debug(
                        `[mls] Conversation ${id} could not read an event and asked the group to catch it up.`,
                    );
                    await requestCatchUp(id, ready);
                    return;
                }
                if (code === 'unknown') {
                    logger.error(`[mls] Conversation ${id} could not process an event; holding it for a retry.`, error);
                }
                const deferred = sessionsRef.current.deferred.get(id) ?? [];
                sessionsRef.current.deferred.set(id, [...deferred.slice(-DEFERRED_PAYLOAD_LIMIT), ciphertext]);
                if (code === 'wrongEpoch') {
                    logger.debug(`[mls] Conversation ${id} deferred an event from an epoch it has not reached.`);
                }
                await requestCatchUp(id, ready);
                return;
            }
            try {
                if (!processed.senderIsMember) {
                    throw new Error('MLS application message was not authored by an authenticated group member');
                }
                if (Number(processed.senderMemberNumber) === Number(ready.membership.ownMemberNumber)) {
                    throw new Error('MLS application message was authored by this member');
                }
                const inbound = await acceptChatEvent(
                    processed.payload,
                    processed.senderMemberNumber,
                    ready.membership,
                    serverTime(),
                    (author, bytes, signature) => getMlsWorkerClient().verifyAuthor(id, author, bytes, signature),
                    ready.epoch,
                );
                const senderMember = ready.membership.roster.find(
                    (member) => Number(member.memberNumber) === Number(processed.senderMemberNumber),
                );
                if (
                    senderMember !== undefined &&
                    senderMember.publicKey.length > 0 &&
                    isBlocked(senderMember.publicKey)
                ) {
                    logger.debug(`[mls] Conversation ${id} dropped an event from a blocked member.`);
                    return;
                }
                if (inbound.kind === 'profile') {
                    const known = ready.membership.roster.some(
                        (member) => Number(member.memberNumber) === Number(inbound.author) && member.name !== undefined,
                    );
                    absorbProfile(id, inbound.author, inbound.name, inbound.locator, inbound.serverUrl);
                    if (!known) await sendProfile(id, sessionsRef.current.ready.get(id) ?? ready);
                    await requestCatchUp(id, ready);
                } else if (inbound.kind === 'batch') {
                    for (const frame of inbound.frames) {
                        const item = await acceptChatEvent(
                            frame,
                            processed.senderMemberNumber,
                            ready.membership,
                            serverTime(),
                            (author, bytes, signature) =>
                                getMlsWorkerClient().verifyAuthor(id, author, bytes, signature),
                            ready.epoch,
                        ).catch((error: unknown) => {
                            logger.debug(`[mls] Conversation ${id} dropped an event from a history batch.`, error);
                            return undefined;
                        });
                        if (item?.kind !== 'record') continue;
                        const writer = ready.membership.roster.find(
                            (member) => Number(member.memberNumber) === Number(item.record.author),
                        );
                        if (writer !== undefined && writer.publicKey.length > 0 && isBlocked(writer.publicKey))
                            continue;
                        eventHandlersRef.current.get(id)?.onEvent?.(item);
                    }
                } else if (inbound.kind === 'inventory') {
                    await serveInventory(id, ready, inbound.inventory, processed.senderMemberNumber);
                    if (!inbound.reply) {
                        await sendInventory(id, ready, getChatStore(id).getRecords(), true);
                    }
                } else {
                    eventHandlersRef.current.get(id)?.onEvent?.(inbound);
                }
            } finally {
                processed.payload.fill(0);
            }
        },
        [
            absorbProfile,
            getMlsWorkerClient,
            isBlocked,
            logger,
            requestCatchUp,
            sendInventory,
            sendProfile,
            serveInventory,
        ],
    );

    const flushDeferred = useCallback(
        async (id: ConversationId, ready: DirectMlsBootstrapResult): Promise<void> => {
            const deferred = sessionsRef.current.deferred.get(id);
            if (deferred === undefined || deferred.length === 0) return;
            sessionsRef.current.deferred.set(id, []);
            for (const ciphertext of deferred) {
                await deliverApplication(id, ready, ciphertext);
            }
        },
        [deliverApplication],
    );

    /** Returns undefined when an invite must not create a conversation, so the frame is dropped rather than obeyed. */
    const inviteDecisionsRef = useRef<Map<string, Promise<GroupInviteDecision>>>(new Map());

    const resolveFrameConversation = useCallback(
        async (
            fallbackId: ConversationId,
            connection: Connection,
            frame: ReturnType<typeof tryDecodeDirectMlsWireFrame>,
        ): Promise<ConversationId | undefined> => {
            if (frame === undefined || frame.kind === 'hello') return fallbackId;
            const key = routingKey(frame.routingId);
            const routed = sessionsRef.current.routes.get(key);
            if (routed !== undefined) return routed;
            if (frame.kind !== 'invite') return fallbackId;
            if (isBlocked(connection.publicKey) || directConversationOf(connection.publicKey) === undefined) {
                return undefined;
            }
            // The owner replays an invite on every reconnect, so one question per routing ID stands for all replays.
            let pending = inviteDecisionsRef.current.get(key);
            if (pending === undefined) {
                pending = requestGroupInvite(connection.publicKey, groupNameFor(frame.roster));
                inviteDecisionsRef.current.set(key, pending);
            }
            const decision = await pending;
            if (decision === 'block') blockLocator(connection.publicKey, connection.serverUrl);
            if (decision !== 'accept') {
                if (decision === 'dismiss' && inviteDecisionsRef.current.get(key) === pending) {
                    inviteDecisionsRef.current.delete(key);
                }
                return undefined;
            }
            inviteDecisionsRef.current.delete(key);
            const accepted = sessionsRef.current.routes.get(key);
            if (accepted !== undefined) return accepted;
            const id = createGroupConversation(frame.routingId, groupNameFor(frame.roster));
            registerTransport(id, connection);
            onConnectionStateChanged(id, connection, connection.state, connection.state);
            return id;
        },
        [
            blockLocator,
            createGroupConversation,
            directConversationOf,
            groupNameFor,
            isBlocked,
            onConnectionStateChanged,
            registerTransport,
            requestGroupInvite,
        ],
    );

    const handleConnectionMessage = useCallback(
        async (fallbackId: ConversationId, connection: Connection, message: Uint8Array): Promise<void> => {
            if (isSelfChatConnection(connection)) {
                const handler = eventHandlersRef.current.get(fallbackId)?.onEvent;
                if (handler === undefined) return;
                const update = JSON.parse(decodeSelfChatMessage(message)) as UpdateType;
                for (const event of fromSelfChatUpdate(update)) handler(event);
                return;
            }
            const frame = tryDecodeDirectMlsWireFrame(message);
            const id = await resolveFrameConversation(fallbackId, connection, frame);
            if (id === undefined) return;
            if (frame?.kind === 'application' || frame?.kind === 'relay') {
                const ready = await waitForDirectMls(id, connection);
                if (!sameBytes(ready.routingId, frame.routingId)) {
                    throw new Error('MLS application frame routing ID does not match the direct conversation');
                }
                if (!(await markPayloadSeen(id, frame.message))) return;
                relayPayload(
                    id,
                    ready.routingId,
                    frame.message,
                    frame.kind === 'relay' ? frame.hops : RELAY_HOPS,
                    connection.publicKey,
                );
                await deliverApplication(id, ready, frame.message);
                return;
            }
            let session = sessionsRef.current.inviteJoiners.get(id);
            const joinable =
                conversationListRef.current.find((candidate) => candidate.id === id)?.kind !== 'direct' &&
                !sessionsRef.current.ready.has(id);
            if (frame?.kind === 'invite' && !joinable) {
                logger.debug(`[mls] Conversation ${id} ignored an invite it is already established for.`);
                return;
            }
            if (frame?.kind === 'invite' || (session !== undefined && frame?.kind === 'addMember')) {
                if (session === undefined) {
                    sessionsRef.current.bootstraps.get(id)?.delete(connection.publicKey);
                    session = new MlsInviteJoinerSession({
                        conversationId: id,
                        ownPublicKey: requireEphemonCore().publicKey ?? '',
                        mls: getMlsWorkerClient(),
                        send: (bytes) => connection.send(bytes),
                        onJoined: (result) => {
                            sessionsRef.current.markReady(id, result);
                            persistMlsRoster(id, result.membership, result.epoch, result.routingId);
                            renameGroupFromRoster(id, result.membership.roster);
                            openGroupTransportsRef.current(id, result.membership.roster).catch(logger.error);
                            sendProfile(id, result).catch(logger.error);
                            sendInventory(id, result, getChatStore(id).getRecords()).catch(logger.error);
                        },
                    });
                    sessionsRef.current.inviteJoiners.set(id, session);
                }
                await session.receive(message);
                return;
            }
            const owner = sessionsRef.current.inviteOwners.get(inviteSessionKey(id, connection.publicKey));
            if (owner !== undefined && frame !== undefined && frame.kind !== 'commit') {
                await owner.receive(message);
                return;
            }
            if (frame?.kind === 'commitsWanted') {
                const ready = sessionsRef.current.ready.get(id) ?? (await restoreGroupMls(id));
                if (ready === undefined || !sameBytes(ready.routingId, frame.routingId)) return;
                for (const commit of commitsAfter(await database.getMlsCommits(id), frame.epoch)) {
                    connection.send(
                        encodeDirectMlsWireFrame({ kind: 'commit', routingId: ready.routingId, commit: commit.commit }),
                    );
                }
                return;
            }
            if (frame?.kind === 'commit') {
                const ready = await waitForDirectMls(id, connection);
                if (!sameBytes(ready.routingId, frame.routingId)) {
                    throw new Error('MLS commit frame routing ID does not match the conversation');
                }
                await runExclusiveCommit(id, async () => {
                    const current = sessionsRef.current.ready.get(id) ?? ready;
                    const outcome = await applyCommitOrDrop(id, frame.commit, current);
                    if (outcome === undefined) return;
                    await recordCommit(id, frame.commit);
                    const arrived = outcome.added.map((member: MemberNumber) => Number(member));
                    /** Seats an added member at the epoch it really joined; its profile fills in locator and name. */
                    const seated = arrived.filter(
                        (member) => !current.membership.roster.some((known) => Number(known.memberNumber) === member),
                    );
                    const roster = [
                        ...current.membership.roster.map((member) =>
                            arrived.includes(Number(member.memberNumber)) && member.joinedEpoch === undefined
                                ? { ...member, joinedEpoch: outcome.epoch.toString() }
                                : member,
                        ),
                        ...seated.map((member) => ({
                            memberNumber: toMemberNumber(member),
                            publicKey: '',
                            joinedEpoch: outcome.epoch.toString(),
                        })),
                    ].sort((left, right) => Number(left.memberNumber) - Number(right.memberNumber));
                    const advanced = {
                        ...current,
                        epoch: outcome.epoch,
                        membership: { ...current.membership, roster },
                    };
                    sessionsRef.current.ready.set(id, advanced);
                    persistMlsRoster(id, advanced.membership, advanced.epoch, advanced.routingId);
                    logger.debug(
                        `[mls] Conversation ${id} advanced to epoch ${outcome.epoch} by member ${outcome.senderMemberNumber}.`,
                    );
                    return advanced;
                }).then(async (advanced) => {
                    if (advanced === undefined) return;
                    sessionsRef.current.catchUpAsked.delete(id);
                    await flushDeferred(id, advanced);
                    await requestCatchUp(id, advanced);
                });
                return;
            }
            if (frame !== undefined) {
                const session = await startDirectMlsBootstrap(id, connection);
                await session.receive(message);
                return;
            }
            throw new Error('Direct conversation received an unsupported non-MLS link frame');
        },
        [
            applyCommitOrDrop,
            database,
            deliverApplication,
            flushDeferred,
            getMlsWorkerClient,
            logger,
            markPayloadSeen,
            relayPayload,
            persistMlsRoster,
            recordCommit,
            renameGroupFromRoster,
            requestCatchUp,
            resolveFrameConversation,
            restoreGroupMls,
            runExclusiveCommit,
            sendInventory,
            sendProfile,
            startDirectMlsBootstrap,
            waitForDirectMls,
        ],
    );

    const groupConnectionState = useCallback(
        (id: ConversationId, fallback: ConnectionState): ConnectionState => {
            const conversation = conversationListRef.current.find((candidate) => candidate.id === id);
            if (conversation?.kind !== 'group') return fallback;
            const ownPublicKey = requireEphemonCore().publicKey;
            const states = (mlsBootstrapsRef.current.get(id)?.roster ?? [])
                .filter(
                    (member) =>
                        member.publicKey !== ownPublicKey && directConversationOf(member.publicKey) !== undefined,
                )
                .map((member) => transportsRef.current.stateOf(id, member.publicKey));
            if (states.length === 0) return fallback;
            if (states.every((state) => state === ConnectionState.Open || state === ConnectionState.Degraded)) {
                return ConnectionState.Open;
            }
            return states.some((state) => state === ConnectionState.Connecting) ? ConnectionState.Connecting : fallback;
        },
        [directConversationOf],
    );

    const handleConnectionStateChanged = useCallback(
        (id: ConversationId, connection: Connection, from: ConnectionState, to: ConnectionState) => {
            const effective = groupConnectionState(id, to);
            onConnectionStateChanged(id, connection, from, effective);
            eventHandlersRef.current.get(id)?.onStateChanged?.(from, effective);
            const live = to === ConnectionState.Open || to === ConnectionState.Degraded;
            const group = conversationListRef.current.find((candidate) => candidate.id === id)?.kind === 'group';
            const inviting = sessionsRef.current.inviteOwners.get(inviteSessionKey(id, connection.publicKey));
            if (inviting !== undefined) {
                const seated = sessionsRef.current.ready
                    .get(id)
                    ?.membership.roster.some((member) => member.publicKey === connection.publicKey);
                if (seated === true) {
                    sessionsRef.current.inviteOwners.delete(inviteSessionKey(id, connection.publicKey));
                    const reserved = sessionsRef.current.reservedNumbers.get(id);
                    for (const member of sessionsRef.current.ready.get(id)?.membership.roster ?? []) {
                        reserved?.delete(Number(member.memberNumber));
                    }
                } else {
                    if (live) inviting.invite();
                    return;
                }
            }
            if (live && group) reconcile(id).catch(logger.error);
            if (
                !group &&
                !isSelfChatConnection(connection) &&
                (sessionsRef.current.dialled.has(id) || sessionsRef.current.ready.has(id)) &&
                live
            ) {
                const session = sessionsRef.current.bootstraps.get(id)?.get(connection.publicKey);
                if (session === undefined) {
                    startDirectMlsBootstrap(id, connection).catch(logger.error);
                } else {
                    session.linkOpened().catch(logger.error);
                }
            }
        },
        [groupConnectionState, logger, onConnectionStateChanged, reconcile, startDirectMlsBootstrap],
    );

    const attachConnectionEventHandlers = useCallback(
        (id: ConversationId, connection: Connection, replayState = true) => {
            const targets = (): Array<ConversationId> => [
                ...new Set<ConversationId>([id, ...conversationsOnTransport(connection.publicKey)]),
            ];
            connection.onProgress = (progress) => {
                for (const target of targets()) eventHandlersRef.current.get(target)?.onProgress?.(progress);
            };
            connection.onStateChanged = (from, to) => {
                for (const target of targets()) handleConnectionStateChanged(target, connection, from, to);
            };
            connection.onTransportChanged = (transport) => {
                for (const target of targets()) onConnectionTransportChanged(target, connection, transport);
            };
            connection.onMessage = (message) => {
                handleConnectionMessage(directConversationOf(connection.publicKey) ?? id, connection, message).catch(
                    logger.error,
                );
            };

            if (!replayState) return;
            for (const target of targets()) {
                handleConnectionStateChanged(target, connection, connection.state, connection.state);
                if (connection.transport !== undefined) {
                    onConnectionTransportChanged(target, connection, connection.transport);
                }
            }
        },
        [
            conversationsOnTransport,
            directConversationOf,
            handleConnectionMessage,
            handleConnectionStateChanged,
            logger,
            onConnectionTransportChanged,
        ],
    );

    const bindTransport = useCallback(
        (id: ConversationId, connection: Connection) => {
            // One Connection carries a direct conversation and every group riding on that peer, so these three belong
            // to the peer rather than to whichever conversation bound them last.
            connection.onError = (error: ConnectionError) => {
                for (const target of new Set<ConversationId>([id, ...conversationsOnTransport(connection.publicKey)])) {
                    onConnectionError(target, connection, error);
                }
            };
            connection.onClosedByPeer = () =>
                explicitPeerCloseRef.current(directConversationOf(connection.publicKey) ?? id);
            connection.onServerUrlChanged = (serverUrl: string) => {
                patchConversation(directConversationOf(connection.publicKey) ?? id, (conversation) => ({
                    ...conversation,
                    serverUrl,
                }));
            };
            attachConnectionEventHandlers(id, connection);
        },
        [
            attachConnectionEventHandlers,
            conversationsOnTransport,
            directConversationOf,
            patchConversation,
            onConnectionError,
        ],
    );

    const bindConnection = useCallback(
        (id: ConversationId, connection: Connection) => {
            sessionsRef.current.bootstraps.delete(id);
            sessionsRef.current.ready.delete(id);
            sessionsRef.current.offlineAuthoring.delete(id);
            bindTransport(id, connection);
        },
        [bindTransport],
    );

    const _initConnections = useCallback(
        (
            stored: Array<
                EphemonHookConversation & {
                    order: number;
                    clearedFrontier?: StoredClearedFrontier;
                    mlsBootstrap?: StoredMlsBootstrap;
                }
            >,
        ) => {
            // The refs come first: binding a transport replays its state, and that replay reads the conversation
            // list and the roster to decide whether the conversation is a group worth reconciling.
            clearedFrontiersRef.current = new Map(
                stored.flatMap(({ id, clearedFrontier }) =>
                    clearedFrontier === undefined ? [] : [[id, clearedFrontier] as const],
                ),
            );
            mlsBootstrapsRef.current = new Map(
                stored.flatMap(({ id, mlsBootstrap }) =>
                    mlsBootstrap === undefined ? [] : [[id, mlsBootstrap] as const],
                ),
            );
            const restored = stored
                .map(({ id, kind, publicKey, name, namedByUser, serverUrl, mlsBootstrap }) => ({
                    id,
                    kind,
                    publicKey,
                    name,
                    namedByUser,
                    serverUrl,
                    group: mlsBootstrap === undefined ? undefined : groupPresentationOf(mlsBootstrap),
                }))
                .sort((a, b) => a.id - b.id);
            conversationListRef.current = restored;

            const newMap = new Map<ConversationId, Connection>();
            const ownPublicKey = requireEphemonCore().publicKey;
            const accepted = new Set(
                stored
                    .filter((conversation) => conversation.kind === 'direct' && conversation.publicKey.length > 0)
                    .map((conversation) => conversation.publicKey),
            );
            for (const { id, kind, publicKey, serverUrl, order, mlsBootstrap } of stored) {
                setConversationOrder(id, order);
                if (mlsBootstrap !== undefined) registerRouting(id, mlsBootstrap.routingId);
                if (!writerRef.current) continue;
                if (kind === 'group') {
                    for (const member of mlsBootstrap?.roster ?? []) {
                        if (member.publicKey === ownPublicKey) continue;
                        if (!accepted.has(member.publicKey)) continue;
                        if (isBlocked(member.publicKey)) continue;
                        const transport = requireEphemonCore().get(member.publicKey, member.serverUrl);
                        bindTransport(id, transport);
                        registerTransport(id, transport);
                    }
                    continue;
                }
                if (isBlocked(publicKey)) continue;
                const connection = requireEphemonCore().get(publicKey, serverUrl);
                bindConnection(id, connection);
                newMap.set(id, connection);
                registerTransport(id, connection);
            }
            connectionsRef.current = newMap;
            setConversations(restored);
        },
        [isBlocked, bindConnection, bindTransport, registerRouting, registerTransport],
    );

    const _upsertConnection = useCallback(
        (id: ConversationId, connection: Connection) => {
            if (!connectionsRef.current) return;
            for (const moved of replaceTransport(connection)) {
                if (moved !== id) bindTransport(moved, connection);
            }
            bindConnection(id, connection);
            connectionsRef.current.set(id, connection);
            registerTransport(id, connection);
            if (getConversationOrder(id) === 0) {
                setConversationOrder(id, now());
            }
            const previous = conversationListRef.current;
            const existing = previous.find((candidate) => candidate.id === id);
            const conversation = existing ?? {
                id,
                kind: 'direct' as const,
                publicKey: connection.publicKey,
                name: undefined,
                serverUrl: connection.serverUrl,
            };
            if (existing === undefined) {
                const next = [...previous, conversation].sort((a, b) => a.id - b.id);
                conversationListRef.current = next;
                setConversations(next);
            }
            upsertStoredConnection(conversation).catch(logger.error);
        },
        [logger, upsertStoredConnection, bindConnection, bindTransport, registerTransport, replaceTransport],
    );

    const _deleteConversation = useCallback(
        async (id: ConversationId) => {
            if (!connectionsRef.current || !writerRef.current) return;
            const connection = connectionsRef.current.get(id);
            const stored = conversationListRef.current.find((candidate) => candidate.id === id);
            const peerPublicKey = connection?.publicKey ?? stored?.publicKey;
            if (stored?.kind !== 'group' && peerPublicKey !== undefined && peerPublicKey.length > 0) {
                requireEphemonCore().delete(peerPublicKey);
            }
            connectionsRef.current.delete(id);
            transportsRef.current.forget(id);
            eventHandlersRef.current.delete(id);
            clearedFrontiersRef.current.delete(id);
            mlsBootstrapsRef.current.delete(id);
            sessionsRef.current.forget(id);
            forgetConversation(id);
            disposeChatStore(id);
            conversationListRef.current = conversationListRef.current
                .filter((conversation) => conversation.id !== id)
                .sort((a, b) => a.id - b.id);
            setConversations(conversationListRef.current);
            if (database.isUnlocked()) {
                await mlsWorkerClientRef.current?.forget(id).catch(logger.error);
                await Promise.all([
                    database.delete(DB_SLUG_TABLE_CONNECTIONS, id),
                    database.clearMessages(id),
                    database.deleteMlsCheckpoint(id),
                    database.deleteMlsCommits(id),
                ]);
            }
        },
        [database, logger],
    );

    const deleteConversation = useCallback(
        async (id: ConversationId) => {
            await _deleteConversation(id);
            if (getActiveConversation() === id) setActiveConversation(undefined);
        },
        [_deleteConversation],
    );
    explicitPeerCloseRef.current = (id) => {
        const conversation = conversationListRef.current.find((candidate) => candidate.id === id);
        if (conversation?.kind === 'direct') deleteConversation(id).catch(logger.error);
    };

    const [unstable, setUnstable] = useState<[boolean, string | undefined]>([false, undefined]);

    const [needUpdate, setNeedUpdate] = useState<boolean>(false);

    const resolveConnectionInitializedAwaiterRef = useRef<Map<ConversationId, () => void>>(new Map());
    const assertConnectionInitialized = useCallback((id: ConversationId) => {
        if (!connectionsRef.current) return false;
        const connection = connectionsRef.current.get(id);
        const validState =
            connection !== undefined &&
            connection !== null &&
            connection.onProgress !== undefined &&
            connection.onProgress !== null &&
            connection.onStateChanged !== undefined &&
            connection.onStateChanged !== null &&
            connection.onMessage !== undefined &&
            connection.onMessage !== null;
        const resolve = resolveConnectionInitializedAwaiterRef.current.get(id);
        if (validState && resolve !== undefined && resolve !== null) {
            resolve();
            resolveConnectionInitializedAwaiterRef.current.delete(id);
        }
        return validState;
    }, []);
    const connectionInitializedAwaiter = useCallback(
        async (id: ConversationId) => {
            if (assertConnectionInitialized(id)) return;
            await new Promise<void>((resolve) => {
                resolveConnectionInitializedAwaiterRef.current.set(id, resolve);
            });
        },
        [assertConnectionInitialized],
    );
    const onConnection = useCallback(
        (newConnection: Connection, dialled = false): ConversationId | undefined => {
            if (!connectionsRef.current) return undefined;
            const attached = [...connectionsRef.current].find(
                ([, connection]) => connection.publicKey === newConnection.publicKey,
            );
            let id =
                attached?.[0] ??
                conversationListRef.current.find(
                    (conversation) =>
                        conversation.kind === 'direct' && conversation.publicKey === newConnection.publicKey,
                )?.id;
            const connection = attached?.[1] ?? (id !== undefined ? connectionsRef.current.get(id) : undefined);
            if (
                connection !== undefined &&
                connection !== null &&
                connection !== newConnection &&
                connection.state !== ConnectionState.Closed
            ) {
                connection.close();
            }
            // A group member's transport reconnects routinely; only a conversation the user is arriving at takes focus.
            const arriving = dialled || id === undefined || id === null;
            if (id === undefined || id === null) {
                id = nextConversationId();
            }
            if (dialled) sessionsRef.current.dialled.add(id);
            _upsertConnection(id, newConnection);
            if (arriving) {
                onIncomingConnection(newConnection);
                setActiveConversation(id);
            }
            return id;
        },
        [nextConversationId, onIncomingConnection, _upsertConnection],
    );

    const promotedRef = useRef(writer);
    useEffect(() => {
        const wasWriter = promotedRef.current;
        promotedRef.current = writer;
        if (!writer || wasWriter || !unlocked || !hasEphemonCore()) return;
        if (connectionsRef.current !== undefined && connectionsRef.current.size > 0) return;
        getStoredConnections()
            .then((stored) => _initConnections(stored))
            .catch(logger.error);
    }, [writer, unlocked, getStoredConnections, _initConnections, logger]);

    const [disablePushServiceValue] = useSearchParams('__debug_disable_push_service');

    const coreStartedRef = useRef(false);

    useEffect(() => {
        if (
            passwordState === 'valid' &&
            signingKeyPair !== undefined &&
            signingKeyPair !== null &&
            ephemonPrototype !== undefined &&
            ephemonPrototype !== null &&
            !hasEphemonCore() &&
            !coreStartedRef.current
        ) {
            coreStartedRef.current = true;
            const settings = getSettings();
            ephemonPrototype
                .initialize({
                    onMayWorkUnstably: (reason: string) => {
                        setUnstable([true, reason]);
                        return Promise.resolve();
                    },

                    serverUrl: settings.serverUrl,

                    version: process.env.EPHEMON_BUILD_TIMESTAMP,
                    onNewVersion: () => {
                        setNeedUpdate(true);
                    },

                    disablePushService: disablePushServiceValue === 'true' ? true : undefined,
                    vapidKey: settings.vapidKey,
                    onPermissionDefault: onPermissionDefault,
                    onPermissionGranted: onPermissionGranted,
                    onPermissionDenied: onPermissionDenied,

                    signingKeyPair: signingKeyPair,

                    onIncomingConnection: onConnection,
                    iceServers: settings.iceServers,

                    focusOnDial: (publicKey: string) => {
                        if (!connectionsRef.current) return Promise.resolve(false);
                        return focusOnDial(publicKey);
                    },
                    requestDial: (key: string) => {
                        if (!connectionsRef.current) return Promise.resolve(false);
                        if (isBlocked(key)) return Promise.resolve(false);
                        const connection = [...connectionsRef.current.values()].find(
                            ({ publicKey }) => publicKey === key,
                        );
                        return requestDial(key, connection !== undefined && connection !== null);
                    },
                })
                .then(async (_ephemon) => {
                    setEphemonCore(_ephemon);
                    trackServerSync(_ephemon);
                    const storedConnections = await getStoredConnections();
                    _initConnections(storedConnections);
                    setPublicKey(_ephemon.publicKey);
                })
                .catch(logger.error);
        }
    }, [
        passwordState,
        signingKeyPair,
        ephemonPrototype,
        onPermissionDefault,
        onPermissionGranted,
        onPermissionDenied,
        onConnection,
        focusOnDial,
        requestDial,
        getStoredConnections,
        _initConnections,
        logger,
    ]);

    const createConnection = useCallback(
        (publicKey: string, serverUrl?: string) => {
            if (!writerRef.current) return undefined;
            const newConnection = requireEphemonCore().get(publicKey.trim(), serverUrl);
            return onConnection(newConnection, true);
        },
        [onConnection],
    );

    const openGroupTransportsRef = useRef<
        (id: ConversationId, roster: ReadonlyArray<MlsRosterMember>) => Promise<void>
    >(() => Promise.resolve());

    const openGroupTransports = useCallback(
        async (id: ConversationId, roster: ReadonlyArray<{ publicKey: string; serverUrl?: string }>): Promise<void> => {
            const ownPublicKey = requireEphemonCore().publicKey;
            await Promise.all(
                roster.map(async (member) => {
                    if (member.publicKey === ownPublicKey) return;
                    if (directConversationOf(member.publicKey) === undefined) return;
                    if (isBlocked(member.publicKey)) return;
                    const transport = requireEphemonCore().get(member.publicKey, member.serverUrl);
                    registerTransport(id, transport);
                    bindTransport(id, transport);
                    if (transport.state === ConnectionState.Open || transport.state === ConnectionState.Degraded)
                        return;
                    await transport.open().catch(logger.error);
                }),
            );
        },
        [bindTransport, directConversationOf, isBlocked, logger, registerTransport],
    );
    openGroupTransportsRef.current = openGroupTransports;

    const openConnection = useCallback(
        async (id: ConversationId) => {
            if (!connectionsRef.current || !writerRef.current) return;
            const conversation = conversationListRef.current.find((candidate) => candidate.id === id);
            if (conversation?.kind === 'group') {
                await openGroupTransports(id, mlsBootstrapsRef.current.get(id)?.roster ?? []);
                return;
            }
            let connection = connectionsRef.current.get(id);
            if (connection === undefined) {
                if (conversation === undefined) return;
                connection = requireEphemonCore().get(conversation.publicKey, conversation.serverUrl);
                bindConnection(id, connection);
                connectionsRef.current.set(id, connection);
                registerTransport(id, connection);
            }
            sessionsRef.current.dialled.add(id);
            await connectionInitializedAwaiter(id);
            await connection.open();
        },
        [bindConnection, connectionInitializedAwaiter, openGroupTransports, registerTransport],
    );

    const addConversationMember = useCallback(
        async (id: ConversationId, publicKey: string, serverUrl?: string): Promise<void> => {
            if (!writerRef.current) return;
            const ready = sessionsRef.current.ready.get(id) ?? (await restoreGroupMls(id));
            if (ready === undefined) throw new Error('The conversation is not an established MLS group yet');
            if (Number(ready.membership.ownMemberNumber) !== Number(ready.membership.owner)) {
                throw new Error('Only the group owner may add a member under the current commit policy');
            }
            const locator = publicKey.trim();
            if (ready.membership.roster.some((member) => member.publicKey === locator)) return;
            const pending = sessionsRef.current.inviteOwners.get(inviteSessionKey(id, locator));
            if (pending !== undefined) {
                const waiting = requireEphemonCore().get(locator, serverUrl);
                if (waiting.state === ConnectionState.Open || waiting.state === ConnectionState.Degraded) {
                    pending.invite();
                } else {
                    waiting.open().catch(logger.error);
                }
                return;
            }
            const reserved = sessionsRef.current.reservedNumbers.get(id) ?? new Set<number>();
            sessionsRef.current.reservedNumbers.set(id, reserved);
            const taken = [
                ...ready.membership.roster,
                ...[...reserved].map((memberNumber) => ({ memberNumber: toMemberNumber(memberNumber) })),
            ];
            const invitee: MlsRosterMember = {
                memberNumber: nextMemberNumber(taken),
                publicKey: locator,
                serverUrl,
            };
            reserved.add(Number(invitee.memberNumber));
            const connection = requireEphemonCore().get(locator, serverUrl);
            const session = new MlsInviteOwnerSession({
                conversationId: id,
                routingId: ready.routingId,
                membership: ready.membership,
                invitee,
                mls: getMlsWorkerClient(),
                serialize: (task) => runExclusiveCommit(id, task),
                sendToInvitee: (frame) => connection.send(frame),
                sendCommitToMembers: async (commit) => {
                    await recordCommit(id, commit).catch(logger.error);
                    const frame = encodeDirectMlsWireFrame({ kind: 'commit', routingId: ready.routingId, commit });
                    const targets = usableTransports(id).filter((transport) => transport.publicKey !== locator);
                    for (const transport of targets) {
                        transport.send(frame);
                    }
                },
                onInviteeJoined: () => {
                    const latest = sessionsRef.current.ready.get(id);
                    if (latest !== undefined) sendProfile(id, latest).catch(logger.error);
                },
                onRosterChanged: (epoch) => {
                    reserved.delete(Number(invitee.memberNumber));
                    const latest = sessionsRef.current.ready.get(id) ?? ready;
                    const known = latest.membership.roster.some(
                        (member) => Number(member.memberNumber) === Number(invitee.memberNumber),
                    );
                    const stamped = (known ? latest.membership.roster : [...latest.membership.roster, invitee])
                        .map((member) =>
                            Number(member.memberNumber) === Number(invitee.memberNumber)
                                ? {
                                      ...member,
                                      publicKey: member.publicKey.length > 0 ? member.publicKey : locator,
                                      serverUrl: member.serverUrl ?? serverUrl,
                                      joinedEpoch: epoch.toString(),
                                  }
                                : member,
                        )
                        .sort((left, right) => Number(left.memberNumber) - Number(right.memberNumber));
                    const membership: DirectMlsMembership = { ...latest.membership, roster: stamped };
                    sessionsRef.current.ready.set(id, { ...latest, epoch, membership });
                    persistMlsRoster(id, membership, epoch, latest.routingId);
                    renameGroupFromRoster(id, stamped);
                },
            });
            sessionsRef.current.inviteOwners.set(inviteSessionKey(id, locator), session);
            registerTransport(id, connection);
            bindTransport(id, connection);
            if (connection.state === ConnectionState.Open || connection.state === ConnectionState.Degraded) {
                session.invite();
            } else {
                connection.open().catch(logger.error);
            }
        },
        [
            bindTransport,
            getMlsWorkerClient,
            sendProfile,
            logger,
            persistMlsRoster,
            recordCommit,
            registerTransport,
            renameGroupFromRoster,
            restoreGroupMls,
            runExclusiveCommit,
            usableTransports,
        ],
    );

    const createGroupConversationWithMembers = useCallback(
        async (
            members: ReadonlyArray<{ publicKey: string; serverUrl?: string }>,
            name?: string,
            ownName?: string,
        ): Promise<ConversationId> => {
            if (!writerRef.current) throw new Error('An observer tab cannot create a group');
            const ownPublicKey = requireEphemonCore().publicKey;
            if (ownPublicKey === undefined) throw new Error('Cannot create a group before login completes');
            const routingId = crypto.getRandomValues(new Uint8Array(ROUTING_ID_BYTES));
            const groupId = crypto.getRandomValues(new Uint8Array(MLS_GROUP_ID_BYTES));
            const id = createGroupConversation(routingId, name);
            const owner = toMemberNumber(0);
            const membership: DirectMlsMembership = {
                role: 'creator',
                ownMemberNumber: owner,
                owner,
                roster: [{ memberNumber: owner, publicKey: ownPublicKey, name: ownName, joinedEpoch: '0' }],
            };
            const mls = getMlsWorkerClient();
            await mls.initialize(id, owner);
            await mls.createGroup(
                id,
                groupId,
                encodeDirectMlsBootstrapFrame({ kind: 'initialize', routingId, groupId }),
            );
            const epoch = (await mls.inspect(id)).epoch ?? 0n;
            sessionsRef.current.ready.set(id, { routingId, epoch, membership });
            persistMlsRoster(id, membership, epoch, routingId);
            for (const member of members) {
                await addConversationMember(id, member.publicKey, member.serverUrl);
            }
            setActiveConversation(id);
            return id;
        },
        [addConversationMember, createGroupConversation, getMlsWorkerClient, persistMlsRoster],
    );

    const resolveOfflineMlsAuthoring = useCallback(
        async (id: ConversationId): Promise<DirectMlsBootstrapResult | undefined> => {
            const live = sessionsRef.current.ready.get(id);
            if (live !== undefined) return live;
            const cached = sessionsRef.current.offlineAuthoring.get(id);
            if (cached !== undefined) return cached;
            const bootstrap = mlsBootstrapsRef.current.get(id);
            if (bootstrap === undefined) return undefined;
            const mls = getMlsWorkerClient();
            await mls.initialize(id, bootstrap.ownMemberNumber);
            const restored: DirectMlsBootstrapResult = {
                routingId: Uint8Array.from(bootstrap.routingId),
                epoch: BigInt(bootstrap.epoch),
                membership: membershipFrom(bootstrap),
            };
            sessionsRef.current.offlineAuthoring.set(id, restored);
            return restored;
        },
        [getMlsWorkerClient],
    );

    const authorAndSendMlsEvent = useCallback(
        async (
            id: ConversationId,
            ready: DirectMlsBootstrapResult,
            operation: Exclude<ChatOperation, { kind: 'sync' }>,
        ): Promise<ChatEventRecord | undefined> =>
            runExclusiveCommit(id, async () => {
                const stored = getMlsWorkerClient().getCheckpointChain(id);
                const chain = stored === undefined ? { sequence: 0 } : decodeChatChainState(stored);
                const quoted = operation.kind === 'text' ? operation.replyTo?.id : undefined;
                const authored = await authorChatEvent(
                    operation,
                    chain,
                    ready.membership,
                    observedHybridLogicalTime(id),
                    serverTime(),
                    (bytes) => getMlsWorkerClient().sign(id, bytes),
                    ready.epoch,
                    quoted === undefined ? undefined : getChatStore(id).getRecord(quoted)?.author,
                );
                await emitMlsEvent(
                    id,
                    ready.routingId,
                    authored.bytes,
                    operation.kind === 'typing' ? undefined : authored.chain,
                );
                return authored.record;
            }),
        [emitMlsEvent, getMlsWorkerClient, runExclusiveCommit],
    );

    const sendMessage = useCallback(
        async (id: ConversationId, operation: ChatOperation): Promise<ChatEventRecord | undefined> => {
            if (!connectionsRef.current || !writerRef.current) return undefined;
            const group = conversationListRef.current.find((candidate) => candidate.id === id)?.kind === 'group';
            if (group) {
                await sessionsRef.current.reconciles.get(id);
                await sessionsRef.current.rekeys.get(id);
                const live = usableTransports(id).length > 0;
                if (operation.kind === 'typing' && !live) return undefined;
                const ready = sessionsRef.current.ready.get(id) ?? (await restoreGroupMls(id));
                if (ready === undefined) return undefined;
                if (operation.kind === 'sync') {
                    if (live) await sendInventory(id, ready, operation.records);
                    return undefined;
                }
                return await authorAndSendMlsEvent(id, ready, operation);
            }
            const connection = connectionsRef.current.get(id);
            if (connection === undefined || connection === null) return undefined;
            const usable = connection.state === ConnectionState.Open || connection.state === ConnectionState.Degraded;
            if (isSelfChatConnection(connection)) {
                const authored = toSelfChatUpdate(operation);
                if (usable) connection.send(encodeSelfChatMessage(JSON.stringify(authored.update)));
                return authored.record;
            }
            if (operation.kind === 'typing') {
                if (!usable) return undefined;
                const ready = sessionsRef.current.ready.get(id);
                if (ready === undefined) return undefined;
                return await authorAndSendMlsEvent(id, ready, operation);
            }
            const ready = usable ? await waitForDirectMls(id, connection) : await resolveOfflineMlsAuthoring(id);
            if (ready === undefined) return undefined;
            if (operation.kind === 'sync') {
                if (!usable) return undefined;
                await sendInventory(id, ready, operation.records);
                return undefined;
            }
            return await authorAndSendMlsEvent(id, ready, operation);
        },
        [
            authorAndSendMlsEvent,
            resolveOfflineMlsAuthoring,
            restoreGroupMls,
            sendInventory,
            usableTransports,
            waitForDirectMls,
        ],
    );

    const saveHistory = useCallback(
        async (id: ConversationId, upserts: ReadonlyArray<ChatEventRecord>) => {
            if (!unlocked || !writerRef.current) return;
            if (upserts.length === 0) return;
            await database.putMessages(id, upserts);
            publishHistoryChange({ id, cleared: false });
        },
        [unlocked, database],
    );

    const getHistory = useCallback(
        async (id: ConversationId): Promise<Array<ChatEventRecord>> => {
            if (unlocked) {
                return await database.getMessages(id);
            }
            return [];
        },
        [unlocked, database],
    );

    const clearHistory = useCallback(
        async (id: ConversationId, records: ReadonlyArray<ChatEventRecord>) => {
            if (!unlocked) return;
            if (!writerRef.current) return;
            const stored = await database.getMessages(id);
            if (stored.length === 0 && records.length === 0) return;
            const known = new Map(stored.map((record) => [record.id, record]));
            for (const record of records) known.set(record.id, record);
            const frontier = computeChatFrontier([...known.values()], clearedFrontierOf(id));
            const cleared = frontier
                .map((entry) => ({ author: Number(entry.author), through: entry.highest }))
                .filter((entry) => entry.through >= 0);
            if (cleared.length > 0) {
                clearedFrontiersRef.current.set(id, cleared);
                const conversation = conversationListRef.current.find((candidate) => candidate.id === id);
                if (conversation !== undefined) await upsertStoredConnection(conversation);
            }
            await database.clearMessages(id);
            publishHistoryChange({ id, cleared: true });
        },
        [unlocked, database, clearedFrontierOf, upsertStoredConnection],
    );

    const setConnectionOrder = useCallback(
        (id: ConversationId, value: number) => {
            const conversation = conversationListRef.current.find((candidate) => candidate.id === id);
            if (conversation === undefined) return;
            setConversationOrder(id, value);
            upsertStoredConnection(conversation).catch(logger.error);
        },
        [logger, upsertStoredConnection],
    );

    const setConnectionName = useCallback(
        (id: ConversationId, value: string | undefined) => {
            const named = value !== undefined && value.trim().length > 0;
            patchConversation(id, (conversation) => ({
                ...conversation,
                name: value,
                namedByUser: conversation.kind === 'group' ? named : conversation.namedByUser,
            }));
        },
        [patchConversation],
    );

    const setOnProgress = useCallback(
        (id: ConversationId, onProgress: (progress: number) => void) => {
            const handlers = eventHandlersRef.current.get(id) ?? {};
            handlers.onProgress = onProgress;
            eventHandlersRef.current.set(id, handlers);
            const connection = connectionsRef.current?.get(id);
            if (connection !== undefined) {
                attachConnectionEventHandlers(id, connection, false);
            }
            assertConnectionInitialized(id);
        },
        [assertConnectionInitialized, attachConnectionEventHandlers],
    );

    const setOnStateChanged = useCallback(
        (id: ConversationId, onStateChanged: (from: ConnectionState, to: ConnectionState) => void) => {
            const handlers = eventHandlersRef.current.get(id) ?? {};
            handlers.onStateChanged = onStateChanged;
            eventHandlersRef.current.set(id, handlers);
            const connection = connectionsRef.current?.get(id);
            if (connection !== undefined) {
                attachConnectionEventHandlers(id, connection, false);
                onStateChanged(connection.state, groupConnectionState(id, connection.state));
            }
            assertConnectionInitialized(id);
        },
        [assertConnectionInitialized, attachConnectionEventHandlers, groupConnectionState],
    );

    const setOnEvent = useCallback(
        (id: ConversationId, onEvent: (event: InboundChatEvent) => void) => {
            const handlers = eventHandlersRef.current.get(id) ?? {};
            handlers.onEvent = onEvent;
            eventHandlersRef.current.set(id, handlers);
            const connection = connectionsRef.current?.get(id);
            if (connection !== undefined) {
                attachConnectionEventHandlers(id, connection, false);
            }
            assertConnectionInitialized(id);
        },
        [assertConnectionInitialized, attachConnectionEventHandlers],
    );

    const metadata = useMemo<EphemonHookMetadata>(
        () => ({ needUpdate, unstable, password: passwordState, writer }),
        [needUpdate, unstable, passwordState, writer],
    );

    const callbacks = useMemo<EphemonHookConnectionCallbacks>(
        () => ({
            lifecycle: { open: openConnection, delete: deleteConversation, addMember: addConversationMember },
            view: { setOrder: setConnectionOrder, setName: setConnectionName, setMemberName: setGroupMemberName },
            messaging: {
                send: sendMessage,
                history: { get: getHistory, save: saveHistory, clear: clearHistory },
            },
            events: { setOnProgress, setOnStateChanged, setOnEvent },
        }),
        [
            addConversationMember,
            openConnection,
            deleteConversation,
            setConnectionOrder,
            setConnectionName,
            setGroupMemberName,
            sendMessage,
            getHistory,
            saveHistory,
            clearHistory,
            setOnProgress,
            setOnStateChanged,
            setOnEvent,
        ],
    );

    const conversationsValue = useMemo<EphemonHookConversations>(
        () => ({
            available: conversations,
            create: createConnection,
            createGroup: createGroupConversationWithMembers,
            blocked: { list: blocked, isBlocked, block: blockLocator, unblock: unblockLocator },
            callbacks,
        }),
        [
            blocked,
            blockLocator,
            conversations,
            createConnection,
            createGroupConversationWithMembers,
            isBlocked,
            unblockLocator,
            callbacks,
        ],
    );

    return useMemo(() => [publicKey, metadata, conversationsValue], [publicKey, metadata, conversationsValue]);
}
