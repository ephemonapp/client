import { disposeChatStore, getChatStore } from '../lib/chatStore';
import {
    forgetConversation,
    getActiveConversation,
    getConversationOrder,
    setActiveConversation,
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
import { MlsWorkerClient } from '../mls/MlsWorkerClient';
import { ChatChainState, decodeChatChainState, encodeChatChainState } from '../mls/chatChain';
import {
    acceptChatEvent,
    authorChatEvent,
    authorInventoryEvent,
    authorProfileEvent,
    isOwnChatEventRecord,
    storedChatEventBytes,
} from '../mls/chatEvent';
import {
    ChatClearedFrontier,
    ChatInventory,
    clampOwnAuthorFrontier,
    computeChatFrontier,
    missingForPeer,
} from '../mls/chatFrontier';
import { COMMIT_AUTHENTICATOR_BYTES, CommitHead, commitsAfter, relateHeads } from '../mls/commitLog';
import {
    assignDirectMlsMembership,
    DirectMlsMembership,
    encodeDirectMlsBootstrapFrame,
    encodeDirectMlsWireFrame,
    MlsRosterMember,
    ROUTING_ID_BYTES,
    tryDecodeDirectMlsWireFrame,
} from '../mls/directBootstrapProtocol';
import { compareHybridLogicalTime, HybridLogicalTime } from '../mls/hybridLogicalClock';
import { createVaultMlsCheckpointStore } from '../mls/mlsCheckpointStore';
import { ChatWindowMessageType } from '../types/chatMessageType';
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
            save: (
                id: ConversationId,
                upserts: ReadonlyArray<ChatEventRecord>,
                deletes: ReadonlyArray<string>,
            ) => Promise<void>;
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

export type EphemonHookConversation = {
    id: ConversationId;
    kind: 'direct' | 'group';
    protocol: 'legacy' | 'mls';
    publicKey: string;
    name: string | undefined;
    serverUrl: string | undefined;
    clearedFrontier?: ReadonlyArray<{ author: number; through: number }>;
    mlsBootstrap?: {
        version: 1;
        routingId: ReadonlyArray<number>;
        epoch: string;
        owner: MemberNumber;
        ownMemberNumber: MemberNumber;
        peerMemberNumber: MemberNumber;
        roster?: ReadonlyArray<{
            memberNumber: number;
            publicKey: string;
            serverUrl?: string;
            joinedEpoch?: string;
            name?: string;
        }>;
    };
};

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
const DEFERRED_PAYLOAD_LIMIT = 63;
const CATCH_UP_WINDOW_MS = 500;
const PUSH_OWN_RECENT = 20;
const COMMIT_TAIL = 16;
const GROUP_FALLBACK_NAME = 'Group';
const SEEN_PAYLOAD_LIMIT = 512;

async function payloadKey(payload: Uint8Array): Promise<string> {
    return routingKey(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(payload))));
}

function routingKey(routingId: Uint8Array | ReadonlyArray<number>): string {
    return Array.from(routingId, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function observedHybridLogicalTime(id: ConversationId): HybridLogicalTime | undefined {
    let observed: HybridLogicalTime | undefined;
    for (const record of getChatStore(id).getRecords()) {
        const candidate = {
            physical: record.timestamp,
            counter: record.counter ?? 0,
        };
        if (observed === undefined || compareHybridLogicalTime(candidate, observed) > 0) observed = candidate;
    }
    return observed;
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
        protocol?: 'legacy' | 'mls';
        publicKey: string;
        order: number;
        name: string | undefined;
        serverUrl: string | undefined;
        clearedFrontier?: EphemonHookConversation['clearedFrontier'];
        mlsBootstrap?: EphemonHookConversation['mlsBootstrap'];
    };
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
            protocol: 'legacy' | 'mls';
            publicKey: string;
            name: string | undefined;
            serverUrl: string | undefined;
            order: number;
            mlsBootstrap?: EphemonHookConversation['mlsBootstrap'];
        }>
    > => {
        if (unlocked) {
            const connections = await database.getAll<DB_CONNECTIONS_TYPE>(DB_SLUG_TABLE_CONNECTIONS);
            return connections.map((connection) => ({
                id: toConversationId(Number(connection.id)),
                kind: connection.value.kind === 'group' ? ('group' as const) : ('direct' as const),
                protocol: connection.value.protocol === 'mls' ? ('mls' as const) : ('legacy' as const),
                publicKey: connection.value.publicKey,
                name: connection.value.name,
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
                protocol: connection.protocol,
                kind: connection.kind,
                publicKey: connection.publicKey,
                name: connection.name,
                serverUrl: connection.serverUrl,
                order: getConversationOrder(connection.id),
                clearedFrontier: connection.clearedFrontier,
                mlsBootstrap: connection.mlsBootstrap,
            };
            if (unlocked) {
                await database.set<DB_CONNECTIONS_TYPE>(DB_SLUG_TABLE_CONNECTIONS, connection.id, data);
            }
        },
        [unlocked, database],
    );

    const setStoredConnections = useCallback(
        async (values: Array<EphemonHookConversation>) => {
            if (unlocked) {
                await database.clear(DB_SLUG_TABLE_CONNECTIONS);
                for (const value of values) {
                    const data = {
                        protocol: value.protocol,
                        kind: value.kind,
                        publicKey: value.publicKey,
                        name: value.name,
                        serverUrl: value.serverUrl,
                        order: getConversationOrder(value.id),
                        clearedFrontier: value.clearedFrontier,
                        mlsBootstrap: value.mlsBootstrap,
                    };
                    await database.set<DB_CONNECTIONS_TYPE>(DB_SLUG_TABLE_CONNECTIONS, value.id, data);
                }
            }
        },
        [unlocked, database],
    );

    const [blocked, setBlocked] = useState<ReadonlyArray<BlockedLocator>>([]);
    const blockedRef = useRef<ReadonlyArray<BlockedLocator>>(blocked);
    blockedRef.current = blocked;

    useEffect(() => {
        if (!unlocked) {
            setBlocked([]);
            return;
        }
        database
            .getAll<BlockedLocator>(DB_SLUG_TABLE_BLOCKED)
            .then((rows) => setBlocked(rows.map((row) => row.value)))
            .catch(() => setBlocked([]));
    }, [unlocked, database]);

    const isBlocked = useCallback(
        (publicKey: string): boolean => blockedRef.current.some((entry) => entry.publicKey === publicKey),
        [],
    );

    const blockLocator = useCallback(
        (publicKey: string, serverUrl?: string): void => {
            if (publicKey.length === 0 || isBlocked(publicKey)) return;
            const entry: BlockedLocator = { publicKey, serverUrl, blockedAt: now() };
            setBlocked((previous) => [...previous, entry]);
            database.set<BlockedLocator>(DB_SLUG_TABLE_BLOCKED, publicKey, entry).catch(logger.error);
        },
        [database, isBlocked, logger],
    );

    const unblockLocator = useCallback(
        (publicKey: string): void => {
            setBlocked((previous) => previous.filter((entry) => entry.publicKey !== publicKey));
            database.delete(DB_SLUG_TABLE_BLOCKED, publicKey).catch(logger.error);
        },
        [database, logger],
    );

    const [conversations, setConversations] = useState<Array<EphemonHookConversation>>([]);
    const connectionsRef = useRef<Map<ConversationId, Connection> | undefined>(undefined);
    const conversationTransportsRef = useRef<Map<ConversationId, Map<string, Connection>>>(new Map());
    const conversationListRef = useRef<Array<EphemonHookConversation>>(conversations);
    conversationListRef.current = conversations;

    type ConnectionEventHandlers = {
        onProgress?: (progress: number) => void;
        onStateChanged?: (from: ConnectionState, to: ConnectionState) => void;
        onEvent?: (event: InboundChatEvent) => void;
    };
    const eventHandlersRef = useRef<Map<ConversationId, ConnectionEventHandlers>>(new Map());
    const explicitPeerCloseRef = useRef<(id: ConversationId) => void>(() => {});
    const mlsWorkerClientRef = useRef<MlsWorkerClient | undefined>(undefined);
    const directMlsBootstrapSessionsRef = useRef<Map<ConversationId, Map<string, DirectMlsBootstrapSession>>>(
        new Map(),
    );
    const routedConversationsRef = useRef<Map<string, ConversationId>>(new Map());
    const inviteOwnerSessionsRef = useRef<Map<string, MlsInviteOwnerSession>>(new Map());
    const inviteJoinerSessionsRef = useRef<Map<ConversationId, MlsInviteJoinerSession>>(new Map());
    const directMlsReadyRef = useRef<Map<ConversationId, DirectMlsBootstrapResult>>(new Map());
    const directMlsReadyWaitersRef = useRef<Map<ConversationId, Set<(result: DirectMlsBootstrapResult) => void>>>(
        new Map(),
    );
    const offlineMlsAuthoringRef = useRef<Map<ConversationId, DirectMlsBootstrapResult>>(new Map());
    const dialledRef = useRef<Set<ConversationId>>(new Set());

    useEffect(() => {
        if (!unlocked) {
            directMlsBootstrapSessionsRef.current.clear();
            inviteOwnerSessionsRef.current.clear();
            inviteJoinerSessionsRef.current.clear();
            directMlsReadyRef.current.clear();
            directMlsReadyWaitersRef.current.clear();
            offlineMlsAuthoringRef.current.clear();
            mlsWorkerClientRef.current?.close();
            mlsWorkerClientRef.current = undefined;
            return;
        }
        return () => {
            directMlsBootstrapSessionsRef.current.clear();
            inviteOwnerSessionsRef.current.clear();
            inviteJoinerSessionsRef.current.clear();
            directMlsReadyRef.current.clear();
            directMlsReadyWaitersRef.current.clear();
            offlineMlsAuthoringRef.current.clear();
            mlsWorkerClientRef.current?.close();
            mlsWorkerClientRef.current = undefined;
        };
    }, [unlocked]);

    const seenPayloadsRef = useRef<Map<ConversationId, Set<string>>>(new Map());
    const deferredPayloadsRef = useRef<Map<ConversationId, Array<Uint8Array>>>(new Map());
    const catchUpAskedRef = useRef<Map<ConversationId, number>>(new Map());
    const reconcileRef = useRef<Map<ConversationId, Promise<void>>>(new Map());
    const rekeyRef = useRef<Map<ConversationId, Promise<void>>>(new Map());
    const commitQueueRef = useRef<Map<ConversationId, Promise<unknown>>>(new Map());
    const pendingInvitesRef = useRef<Map<ConversationId, Set<Promise<void>>>>(new Map());

    const runExclusiveCommit = useCallback(<T>(id: ConversationId, task: () => Promise<T>): Promise<T> => {
        const previous = commitQueueRef.current.get(id) ?? Promise.resolve();
        const next = previous.then(task, task);
        commitQueueRef.current.set(
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

    const rosterOf = useCallback((id: ConversationId): ReadonlyArray<MlsRosterMember> => {
        const stored = conversationListRef.current.find((candidate) => candidate.id === id)?.mlsBootstrap;
        return (stored?.roster ?? []).map((member) => ({
            memberNumber: toMemberNumber(member.memberNumber),
            publicKey: member.publicKey,
            serverUrl: member.serverUrl,
            joinedEpoch: member.joinedEpoch,
            name: member.name,
        }));
    }, []);

    const registerRouting = useCallback((id: ConversationId, routingId: Uint8Array | ReadonlyArray<number>): void => {
        routedConversationsRef.current.set(routingKey(routingId), id);
    }, []);

    const conversationsOnTransport = useCallback((peerPublicKey: string): Array<ConversationId> => {
        const ids: Array<ConversationId> = [];
        for (const [id, transports] of conversationTransportsRef.current) {
            if (transports.has(peerPublicKey)) ids.push(id);
        }
        return ids;
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
        const ready = directMlsReadyRef.current.get(id);
        if (ready !== undefined) return ready.membership;
        const stored = conversationListRef.current.find((candidate) => candidate.id === id)?.mlsBootstrap;
        if (stored !== undefined && stored.roster !== undefined && stored.roster.length > 0) {
            return {
                role: stored.owner === stored.ownMemberNumber ? 'creator' : 'invitee',
                ownMemberNumber: toMemberNumber(stored.ownMemberNumber),
                peerMemberNumber: toMemberNumber(stored.peerMemberNumber),
                owner: toMemberNumber(stored.owner),
                roster: stored.roster.map((member) => ({
                    memberNumber: toMemberNumber(member.memberNumber),
                    publicKey: member.publicKey,
                    serverUrl: member.serverUrl,
                    joinedEpoch: member.joinedEpoch,
                    name: member.name,
                })),
            };
        }
        const ownPublicKey = requireEphemonCore().publicKey;
        if (ownPublicKey === undefined) throw new Error('Cannot elect direct MLS members before login completes');
        return assignDirectMlsMembership(ownPublicKey, connection.publicKey, connection.serverUrl);
    }, []);

    const startDirectMlsBootstrap = useCallback(
        async (id: ConversationId, connection: Connection): Promise<DirectMlsBootstrapSession> => {
            const peers = directMlsBootstrapSessionsRef.current.get(id) ?? new Map<string, DirectMlsBootstrapSession>();
            directMlsBootstrapSessionsRef.current.set(id, peers);
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
                        directMlsReadyRef.current.set(id, result);
                        registerRouting(id, routingId);
                        const waiters = directMlsReadyWaitersRef.current.get(id);
                        if (waiters !== undefined) {
                            directMlsReadyWaitersRef.current.delete(id);
                            for (const resolve of waiters) resolve(result);
                        }
                        logger.debug(
                            `[mls] Direct conversation ${id} bootstrapped at epoch ${epoch} as member ${membership.ownMemberNumber}.`,
                        );
                        setConversations((previous) => {
                            const updated = previous.map((conversation) =>
                                conversation.id === id
                                    ? {
                                          ...conversation,
                                          protocol: 'mls' as const,
                                          mlsBootstrap: {
                                              version: 1 as const,
                                              routingId: Array.from(routingId),
                                              epoch: epoch.toString(),
                                              owner: membership.owner,
                                              ownMemberNumber: membership.ownMemberNumber,
                                              peerMemberNumber: membership.peerMemberNumber,
                                              roster: membership.roster.map((member) => ({
                                                  memberNumber: Number(member.memberNumber),
                                                  publicKey: member.publicKey,
                                                  serverUrl: member.serverUrl,
                                                  joinedEpoch: member.joinedEpoch,
                                                  name: member.name,
                                              })),
                                          },
                                      }
                                    : conversation,
                            );
                            const completed = updated.find((conversation) => conversation.id === id);
                            if (completed !== undefined) upsertStoredConnection(completed).catch(logger.error);
                            return updated;
                        });
                    },
                });
                peers.set(connection.publicKey, session);
            }
            await session.start();
            return session;
        },
        [getMlsWorkerClient, logger, membershipFor, registerRouting, upsertStoredConnection],
    );

    const restoreGroupMls = useCallback(
        async (id: ConversationId): Promise<DirectMlsBootstrapResult | undefined> => {
            const conversation = conversationListRef.current.find((candidate) => candidate.id === id);
            const bootstrap = conversation?.kind === 'group' ? conversation.mlsBootstrap : undefined;
            if (bootstrap === undefined) return undefined;
            const mls = getMlsWorkerClient();
            await mls.initialize(id, bootstrap.ownMemberNumber);
            const epoch = (await mls.inspect(id)).epoch ?? BigInt(bootstrap.epoch);
            const restored: DirectMlsBootstrapResult = {
                routingId: Uint8Array.from(bootstrap.routingId),
                epoch,
                membership: {
                    role: bootstrap.owner === bootstrap.ownMemberNumber ? 'creator' : 'invitee',
                    ownMemberNumber: bootstrap.ownMemberNumber,
                    peerMemberNumber: bootstrap.peerMemberNumber,
                    owner: bootstrap.owner,
                    roster: (bootstrap.roster ?? []).map((member) => ({
                        memberNumber: toMemberNumber(member.memberNumber),
                        publicKey: member.publicKey,
                        serverUrl: member.serverUrl,
                        joinedEpoch: member.joinedEpoch,
                        name: member.name,
                    })),
                },
            };
            directMlsReadyRef.current.set(id, restored);
            registerRouting(id, restored.routingId);
            if (Number(bootstrap.ownMemberNumber) === Number(bootstrap.owner)) {
                const rekey = (async () => {
                    const parent = { epoch, authenticator: new Uint8Array(COMMIT_AUTHENTICATOR_BYTES) };
                    const commit = await mls.createSelfUpdate(id);
                    await mls.mergePendingCommit(id);
                    const head = (await mls.inspect(id)).epoch ?? epoch;
                    restored.epoch = head;
                    directMlsReadyRef.current.set(id, restored);
                    await database.appendMlsCommit(id, {
                        epoch: head.toString(),
                        authenticator: Uint8Array.from((await mls.inspect(id)).epochAuthenticator ?? new Uint8Array()),
                        parentEpoch: parent.epoch.toString(),
                        commit: Uint8Array.from(commit),
                    });
                    const frame = encodeDirectMlsWireFrame({ kind: 'commit', routingId: restored.routingId, commit });
                    for (const transport of conversationTransportsRef.current.get(id)?.values() ?? []) {
                        if (transport.state === ConnectionState.Open || transport.state === ConnectionState.Degraded) {
                            transport.send(frame);
                        }
                    }
                })();
                rekeyRef.current.set(
                    id,
                    rekey.catch(() => undefined),
                );
                await rekey;
            }
            return restored;
        },
        [database, getMlsWorkerClient, registerRouting],
    );

    const waitForDirectMls = useCallback(
        async (id: ConversationId, connection: Connection): Promise<DirectMlsBootstrapResult> => {
            const ready = directMlsReadyRef.current.get(id);
            if (ready !== undefined) return ready;
            const restored = await restoreGroupMls(id);
            if (restored !== undefined) return restored;
            const joining = inviteJoinerSessionsRef.current.has(id);
            const completion = new Promise<DirectMlsBootstrapResult>((resolve) => {
                let waiters = directMlsReadyWaitersRef.current.get(id);
                if (waiters === undefined) {
                    waiters = new Set();
                    directMlsReadyWaitersRef.current.set(id, waiters);
                }
                waiters.add(resolve);
            });
            if (!joining && dialledRef.current.has(id)) await startDirectMlsBootstrap(id, connection);
            return directMlsReadyRef.current.get(id) ?? completion;
        },
        [restoreGroupMls, startDirectMlsBootstrap],
    );

    const persistMlsRoster = useCallback(
        (id: ConversationId, membership: DirectMlsMembership, epoch: bigint, routingId: Uint8Array): void => {
            setConversations((previous) => {
                const updated = previous.map((conversation) =>
                    conversation.id === id
                        ? {
                              ...conversation,
                              protocol: 'mls' as const,
                              mlsBootstrap: {
                                  version: 1 as const,
                                  routingId: Array.from(routingId),
                                  epoch: epoch.toString(),
                                  owner: membership.owner,
                                  ownMemberNumber: membership.ownMemberNumber,
                                  peerMemberNumber: membership.peerMemberNumber,
                                  roster: membership.roster.map((member) => ({
                                      memberNumber: Number(member.memberNumber),
                                      publicKey: member.publicKey,
                                      serverUrl: member.serverUrl,
                                      joinedEpoch: member.joinedEpoch,
                                      name: member.name,
                                  })),
                              },
                          }
                        : conversation,
                );
                const changed = updated.find((conversation) => conversation.id === id);
                if (changed !== undefined) upsertStoredConnection(changed).catch(logger.error);
                return updated;
            });
        },
        [logger, upsertStoredConnection],
    );

    const renameGroupFromRoster = useCallback(
        (id: ConversationId, roster: ReadonlyArray<{ publicKey: string }>): void => {
            if (conversationListRef.current.find((candidate) => candidate.id === id)?.kind !== 'group') return;
            const name = groupNameFor(roster);
            setConversations((previous) => {
                const updated = previous.map((conversation) =>
                    conversation.id === id ? { ...conversation, name } : conversation,
                );
                const changed = updated.find((conversation) => conversation.id === id);
                if (changed !== undefined) upsertStoredConnection(changed).catch(logger.error);
                return updated;
            });
        },
        [groupNameFor, logger, upsertStoredConnection],
    );

    const ownerOf = useCallback((id: ConversationId, ready: DirectMlsBootstrapResult): MemberNumber => {
        const stored = conversationListRef.current.find((candidate) => candidate.id === id)?.mlsBootstrap;
        if (stored !== undefined) return toMemberNumber(stored.owner);
        return ready.membership.role === 'creator'
            ? ready.membership.ownMemberNumber
            : ready.membership.peerMemberNumber;
    }, []);

    const ownCommitHead = useCallback(
        async (id: ConversationId): Promise<CommitHead | undefined> => {
            const inspection = await getMlsWorkerClient().inspect(id);
            if (inspection.epoch === undefined || inspection.epochAuthenticator === undefined) return undefined;
            return { epoch: inspection.epoch, authenticator: inspection.epochAuthenticator };
        },
        [getMlsWorkerClient],
    );

    const applyCommitOrDrop = useCallback(
        async (id: ConversationId, commit: Uint8Array, owner: MemberNumber) => {
            try {
                return await getMlsWorkerClient().processIncomingCommit(id, commit, [owner]);
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                logger.debug(`[mls] Conversation ${id} ignored a commit it cannot apply: ${reason}`);
                return undefined;
            }
        },
        [getMlsWorkerClient, logger],
    );

    const markPayloadSeen = useCallback(async (id: ConversationId, payload: Uint8Array): Promise<boolean> => {
        const seen = seenPayloadsRef.current.get(id) ?? new Set<string>();
        seenPayloadsRef.current.set(id, seen);
        const key = await payloadKey(payload);
        if (seen.has(key)) return false;
        if (seen.size >= SEEN_PAYLOAD_LIMIT) seen.delete(seen.values().next().value as string);
        seen.add(key);
        return true;
    }, []);

    const awaitPendingInvites = useCallback(async (id: ConversationId): Promise<void> => {
        const pending = pendingInvitesRef.current.get(id);
        if (pending === undefined || pending.size === 0) return;
        await Promise.all([...pending]);
    }, []);

    const registerTransport = useCallback((id: ConversationId, connection: Connection): void => {
        const transports = conversationTransportsRef.current.get(id) ?? new Map<string, Connection>();
        transports.set(connection.publicKey, connection);
        conversationTransportsRef.current.set(id, transports);
    }, []);

    const replaceTransport = useCallback((connection: Connection): Array<ConversationId> => {
        const moved: Array<ConversationId> = [];
        for (const [id, transports] of conversationTransportsRef.current) {
            const existing = transports.get(connection.publicKey);
            if (existing === undefined || existing === connection) continue;
            transports.set(connection.publicKey, connection);
            moved.push(id);
        }
        return moved;
    }, []);

    const usableTransports = useCallback((id: ConversationId): Array<Connection> => {
        const transports = conversationTransportsRef.current.get(id);
        if (transports === undefined) return [];
        return [...transports.values()].filter(
            (connection) => connection.state === ConnectionState.Open || connection.state === ConnectionState.Degraded,
        );
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

    const recordCommit = useCallback(
        async (id: ConversationId, commit: Uint8Array, parent: CommitHead | undefined): Promise<void> => {
            const head = await ownCommitHead(id);
            if (head === undefined) return;
            await database.appendMlsCommit(id, {
                epoch: head.epoch.toString(),
                authenticator: Uint8Array.from(head.authenticator),
                parentEpoch: parent?.epoch.toString(),
                parentAuthenticator: parent === undefined ? undefined : Uint8Array.from(parent.authenticator),
                commit: Uint8Array.from(commit),
            });
        },
        [database, ownCommitHead],
    );

    const sendMlsEventBytes = useCallback(
        async (id: ConversationId, routingId: Uint8Array, bytes: Uint8Array, chain?: ChatChainState): Promise<void> => {
            const encrypted = await getMlsWorkerClient().createApplicationMessage(
                id,
                bytes,
                chain === undefined ? undefined : encodeChatChainState(chain),
            );
            const frame = encodeDirectMlsWireFrame({ kind: 'application', routingId, message: encrypted });
            await markPayloadSeen(id, encrypted);
            for (const connection of usableTransports(id)) {
                connection.send(frame);
            }
        },
        [getMlsWorkerClient, markPayloadSeen, usableTransports],
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
        const stored = conversationListRef.current.find((candidate) => candidate.id === id)?.clearedFrontier ?? [];
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
            const roster = [ready.membership.ownMemberNumber, ready.membership.peerMemberNumber];
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
        [clearedFrontierOf, getMlsWorkerClient, sendMlsEventBytes],
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
            const ready = directMlsReadyRef.current.get(id);
            const current = ready?.membership.roster ?? rosterOf(id);
            const known = current.some((member) => Number(member.memberNumber) === Number(author));
            const roster = (
                known ? current : [...current, { memberNumber: author, publicKey: locator, serverUrl }]
            ).map((member) =>
                Number(member.memberNumber) === Number(author)
                    ? { ...member, name, publicKey: locator, serverUrl: serverUrl ?? member.serverUrl }
                    : member,
            );
            roster.sort((left, right) => Number(left.memberNumber) - Number(right.memberNumber));
            if (ready !== undefined) {
                const membership = { ...ready.membership, roster };
                directMlsReadyRef.current.set(id, { ...ready, membership });
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
                logger.error(`[mls] Conversation ${id} diverged at epoch ${own.epoch}; MLS traffic is paused.`);
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

    const serveCommitTail = useCallback(
        async (id: ConversationId, ready: DirectMlsBootstrapResult): Promise<void> => {
            const commits = commitsAfter(await database.getMlsCommits(id), -1n).slice(-COMMIT_TAIL);
            for (const commit of commits) {
                await sendCommitFrame(id, ready.routingId, commit.commit);
            }
        },
        [database, sendCommitFrame],
    );

    const serveInventory = useCallback(
        async (id: ConversationId, ready: DirectMlsBootstrapResult, peer: ChatInventory, peerPublicKey: string) => {
            if (!(await serveCommits(id, ready, peer))) return;
            const { frontier } = peer;
            const records = getChatStore(id).getRecords();
            const roster =
                ready.membership.roster.length > 0
                    ? ready.membership.roster.map((member) => member.memberNumber)
                    : [ready.membership.ownMemberNumber, ready.membership.peerMemberNumber];
            const wanted = missingForPeer(frontier, computeChatFrontier(records, clearedFrontierOf(id), roster));
            if (wanted.length === 0) return;
            const joinedEpoch = ready.membership.roster.find(
                (member) => member.publicKey === peerPublicKey,
            )?.joinedEpoch;
            for (const record of records) {
                if (record.author === undefined || record.sequence === undefined) continue;
                if (
                    joinedEpoch !== undefined &&
                    record.epoch !== undefined &&
                    BigInt(record.epoch) < BigInt(joinedEpoch)
                ) {
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
                if (bytes !== undefined) await sendMlsEventBytes(id, ready.routingId, bytes);
            }
        },
        [clearedFrontierOf, sendMlsEventBytes, serveCommits],
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
                protocol: 'mls',
                publicKey: '',
                name,
                serverUrl: undefined,
            };
            conversationListRef.current = [...conversationListRef.current, conversation].sort((a, b) => a.id - b.id);
            setConversations((previous) =>
                [...previous.filter((candidate) => candidate.id !== id), conversation].sort((a, b) => a.id - b.id),
            );
            upsertStoredConnection(conversation).catch(logger.error);
            return id;
        },
        [logger, nextConversationId, registerRouting, upsertStoredConnection],
    );

    const pushOwnRecent = useCallback(
        async (id: ConversationId, ready: DirectMlsBootstrapResult): Promise<void> => {
            const own = getChatStore(id).getRecords().filter(isOwnChatEventRecord).slice(-PUSH_OWN_RECENT);
            for (const record of own) {
                const bytes = storedChatEventBytes(record);
                if (bytes !== undefined) await sendMlsEventBytes(id, ready.routingId, bytes);
            }
        },
        [sendMlsEventBytes],
    );

    const reconcileGroup = useCallback(
        async (id: ConversationId): Promise<void> => {
            if (conversationListRef.current.find((candidate) => candidate.id === id)?.kind !== 'group') return;
            const ready = directMlsReadyRef.current.get(id) ?? (await restoreGroupMls(id));
            if (ready === undefined || usableTransports(id).length === 0) return;
            await serveCommitTail(id, ready);
            await sendProfile(id, ready);
            await pushOwnRecent(id, ready);
            await sendInventory(id, ready, getChatStore(id).getRecords());
        },
        [pushOwnRecent, restoreGroupMls, sendInventory, sendProfile, serveCommitTail, usableTransports],
    );

    const reconcile = useCallback(
        (id: ConversationId): Promise<void> => {
            const previous = reconcileRef.current.get(id) ?? Promise.resolve();
            const next = previous.then(
                () => reconcileGroup(id),
                () => reconcileGroup(id),
            );
            reconcileRef.current.set(
                id,
                next.catch(() => undefined),
            );
            return next;
        },
        [reconcileGroup],
    );

    const setGroupMemberName = useCallback(
        (id: ConversationId, name: string): void => {
            const ownPublicKey = requireEphemonCore().publicKey;
            if (ownPublicKey === undefined || !writerRef.current) return;
            const ready = directMlsReadyRef.current.get(id);
            const current = ready?.membership.roster ?? rosterOf(id);
            const roster = current.map((member) => (member.publicKey === ownPublicKey ? { ...member, name } : member));
            if (ready !== undefined) {
                const membership = { ...ready.membership, roster };
                directMlsReadyRef.current.set(id, { ...ready, membership });
                persistMlsRoster(id, membership, ready.epoch, ready.routingId);
                sendProfile(id, { ...ready, membership }).catch(logger.error);
                return;
            }
            const stored = conversationListRef.current.find((candidate) => candidate.id === id)?.mlsBootstrap;
            if (stored === undefined) return;
            const membership: DirectMlsMembership = {
                role: stored.owner === stored.ownMemberNumber ? 'creator' : 'invitee',
                ownMemberNumber: toMemberNumber(stored.ownMemberNumber),
                peerMemberNumber: toMemberNumber(stored.peerMemberNumber),
                owner: toMemberNumber(stored.owner),
                roster,
            };
            persistMlsRoster(id, membership, BigInt(stored.epoch), Uint8Array.from(stored.routingId));
            reconcile(id).catch(logger.error);
        },
        [logger, persistMlsRoster, reconcile, rosterOf, sendProfile],
    );

    const requestCatchUp = useCallback(
        async (id: ConversationId, ready: DirectMlsBootstrapResult): Promise<void> => {
            const asked = catchUpAskedRef.current.get(id) ?? 0;
            const moment = now();
            if (moment - asked < CATCH_UP_WINDOW_MS) return;
            catchUpAskedRef.current.set(id, moment);
            await sendInventory(id, ready, getChatStore(id).getRecords());
        },
        [sendInventory],
    );

    const deliverApplication = useCallback(
        async (id: ConversationId, ready: DirectMlsBootstrapResult, ciphertext: Uint8Array): Promise<void> => {
            let processed;
            try {
                processed = await getMlsWorkerClient().processApplicationMessage(id, ciphertext);
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                if (reason.includes('WrongEpoch')) {
                    const deferred = deferredPayloadsRef.current.get(id) ?? [];
                    deferredPayloadsRef.current.set(id, [...deferred.slice(-DEFERRED_PAYLOAD_LIMIT), ciphertext]);
                    logger.debug(`[mls] Conversation ${id} deferred an event from an epoch it has not reached.`);
                    await requestCatchUp(id, ready);
                    return;
                }
                if (!reason.includes('UnableToDecrypt')) throw error;
                logger.debug(`[mls] Conversation ${id} could not read an event and asked the group to catch it up.`);
                await requestCatchUp(id, ready);
                return;
            }
            try {
                if (Number(processed.senderMemberNumber) === Number(ready.membership.ownMemberNumber)) {
                    throw new Error('MLS application message was authored by this member');
                }
                const inbound = await acceptChatEvent(
                    processed.payload,
                    processed.senderMemberNumber,
                    ready.membership,
                    serverTime(),
                    ready.epoch,
                );
                if (inbound.kind === 'profile') {
                    const known = ready.membership.roster.some(
                        (member) => Number(member.memberNumber) === Number(inbound.author) && member.name !== undefined,
                    );
                    absorbProfile(id, inbound.author, inbound.name, inbound.locator, inbound.serverUrl);
                    if (!known) await sendProfile(id, directMlsReadyRef.current.get(id) ?? ready);
                    await requestCatchUp(id, ready);
                } else if (inbound.kind === 'inventory') {
                    const asker = ready.membership.roster.find(
                        (member) => Number(member.memberNumber) === Number(processed.senderMemberNumber),
                    );
                    await serveInventory(id, ready, inbound.inventory, asker?.publicKey ?? '');
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
        [absorbProfile, getMlsWorkerClient, logger, requestCatchUp, sendInventory, sendProfile, serveInventory],
    );

    const flushDeferred = useCallback(
        async (id: ConversationId, ready: DirectMlsBootstrapResult): Promise<void> => {
            const deferred = deferredPayloadsRef.current.get(id);
            if (deferred === undefined || deferred.length === 0) return;
            deferredPayloadsRef.current.set(id, []);
            for (const ciphertext of deferred) {
                await deliverApplication(id, ready, ciphertext);
            }
        },
        [deliverApplication],
    );

    const resolveFrameConversation = useCallback(
        (
            fallbackId: ConversationId,
            connection: Connection,
            frame: ReturnType<typeof tryDecodeDirectMlsWireFrame>,
        ): ConversationId => {
            if (frame === undefined || frame.kind === 'hello') return fallbackId;
            const routed = routedConversationsRef.current.get(routingKey(frame.routingId));
            if (routed !== undefined) return routed;
            if (frame.kind !== 'invite') return fallbackId;
            const id = createGroupConversation(frame.routingId, groupNameFor(frame.roster));
            registerTransport(id, connection);
            onConnectionStateChanged(id, connection, connection.state, connection.state);
            return id;
        },
        [createGroupConversation, groupNameFor, onConnectionStateChanged, registerTransport],
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
            const id = resolveFrameConversation(fallbackId, connection, frame);
            if (frame?.kind === 'application' || frame?.kind === 'relay') {
                const ready = await waitForDirectMls(id, connection);
                if (
                    ready.routingId.byteLength !== frame.routingId.byteLength ||
                    !ready.routingId.every((value, index) => value === frame.routingId[index])
                ) {
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
            const joiner = inviteJoinerSessionsRef.current.get(id);
            if (frame?.kind === 'invite' || (joiner !== undefined && frame?.kind === 'addMember')) {
                let session = inviteJoinerSessionsRef.current.get(id);
                if (session === undefined) {
                    directMlsBootstrapSessionsRef.current.get(id)?.delete(connection.publicKey);
                    session = new MlsInviteJoinerSession({
                        conversationId: id,
                        ownPublicKey: requireEphemonCore().publicKey ?? '',
                        mls: getMlsWorkerClient(),
                        send: (bytes) => connection.send(bytes),
                        onJoined: (result) => {
                            directMlsReadyRef.current.set(id, result);
                            persistMlsRoster(id, result.membership, result.epoch, result.routingId);
                            renameGroupFromRoster(id, result.membership.roster);
                            openGroupTransports(id, result.membership.roster).catch(logger.error);
                            sendProfile(id, result).catch(logger.error);
                            const waiters = directMlsReadyWaitersRef.current.get(id);
                            if (waiters !== undefined) {
                                directMlsReadyWaitersRef.current.delete(id);
                                for (const resolve of waiters) resolve(result);
                            }
                            sendInventory(id, result, getChatStore(id).getRecords()).catch(logger.error);
                        },
                    });
                    inviteJoinerSessionsRef.current.set(id, session);
                }
                await session.receive(message);
                return;
            }
            const owner = inviteOwnerSessionsRef.current.get(inviteSessionKey(id, connection.publicKey));
            if (owner !== undefined && frame !== undefined && frame.kind !== 'commit') {
                await owner.receive(message);
                return;
            }
            if (frame?.kind === 'commit') {
                const ready = await waitForDirectMls(id, connection);
                await runExclusiveCommit(id, async () => {
                    const parent = await ownCommitHead(id);
                    const outcome = await applyCommitOrDrop(id, frame.commit, ownerOf(id, ready));
                    if (outcome === undefined) return;
                    await recordCommit(id, frame.commit, parent);
                    const advanced = { ...(directMlsReadyRef.current.get(id) ?? ready), epoch: outcome.epoch };
                    directMlsReadyRef.current.set(id, advanced);
                    persistMlsRoster(id, advanced.membership, advanced.epoch, advanced.routingId);
                    await flushDeferred(id, advanced);
                    catchUpAskedRef.current.delete(id);
                    await requestCatchUp(id, advanced);
                    logger.debug(
                        `[mls] Conversation ${id} advanced to epoch ${outcome.epoch} by member ${outcome.senderMemberNumber}.`,
                    );
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
            deliverApplication,
            flushDeferred,
            getMlsWorkerClient,
            logger,
            markPayloadSeen,
            ownCommitHead,
            relayPayload,
            ownerOf,
            persistMlsRoster,
            recordCommit,
            requestCatchUp,
            resolveFrameConversation,
            runExclusiveCommit,
            sendInventory,
            serveInventory,
            startDirectMlsBootstrap,
            waitForDirectMls,
        ],
    );

    const groupConnectionState = useCallback(
        (id: ConversationId, fallback: ConnectionState): ConnectionState => {
            const conversation = conversationListRef.current.find((candidate) => candidate.id === id);
            if (conversation?.kind !== 'group') return fallback;
            const ownPublicKey = requireEphemonCore().publicKey;
            const transports = conversationTransportsRef.current.get(id);
            const states = (conversation.mlsBootstrap?.roster ?? [])
                .filter(
                    (member) =>
                        member.publicKey !== ownPublicKey && directConversationOf(member.publicKey) !== undefined,
                )
                .map((member) => transports?.get(member.publicKey)?.state);
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
            const inviting = inviteOwnerSessionsRef.current.get(inviteSessionKey(id, connection.publicKey));
            if (inviting !== undefined) {
                if (to === ConnectionState.Open || to === ConnectionState.Degraded) inviting.invite();
                return;
            }
            if (to === ConnectionState.Open || to === ConnectionState.Degraded) {
                const group = conversationListRef.current.find((candidate) => candidate.id === id)?.kind === 'group';
                if (group) reconcile(id).catch(logger.error);
            }
            if (
                !isSelfChatConnection(connection) &&
                (dialledRef.current.has(id) || directMlsReadyRef.current.has(id)) &&
                (to === ConnectionState.Open || to === ConnectionState.Degraded)
            ) {
                const session = directMlsBootstrapSessionsRef.current.get(id)?.get(connection.publicKey);
                if (session === undefined) {
                    startDirectMlsBootstrap(id, connection).catch(logger.error);
                } else if (from !== ConnectionState.Open && from !== ConnectionState.Degraded) {
                    session.linkOpened().catch(logger.error);
                }
            }
        },
        [
            groupConnectionState,
            logger,
            onConnectionStateChanged,
            pushOwnRecent,
            restoreGroupMls,
            sendCommitFrame,
            sendInventory,
            sendProfile,
            startDirectMlsBootstrap,
            usableTransports,
        ],
    );

    const attachConnectionEventHandlers = useCallback(
        (id: ConversationId, connection: Connection) => {
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
            connection.onError = (error: ConnectionError) => onConnectionError(id, connection, error);
            connection.onClosedByPeer = () => explicitPeerCloseRef.current(id);
            connection.onServerUrlChanged = (serverUrl: string) => {
                setConversations((previous) => {
                    const updatedConversations = previous.map((candidate) =>
                        candidate.id === id ? { ...candidate, serverUrl } : candidate,
                    );
                    const updated = updatedConversations.find((candidate) => candidate.id === id);
                    if (updated !== undefined) upsertStoredConnection(updated).catch(logger.error);
                    return updatedConversations;
                });
            };
            attachConnectionEventHandlers(id, connection);
        },
        [attachConnectionEventHandlers, logger, upsertStoredConnection, onConnectionError],
    );

    const bindConnection = useCallback(
        (id: ConversationId, connection: Connection) => {
            directMlsBootstrapSessionsRef.current.delete(id);
            directMlsReadyRef.current.delete(id);
            offlineMlsAuthoringRef.current.delete(id);
            bindTransport(id, connection);
        },
        [bindTransport],
    );

    const _initConnections = useCallback(
        (stored: Array<EphemonHookConversation & { order: number }>) => {
            const newMap = new Map<ConversationId, Connection>();
            const ownPublicKey = requireEphemonCore().publicKey;
            for (const { id, kind, publicKey, serverUrl, order, mlsBootstrap } of stored) {
                setConversationOrder(id, order);
                if (mlsBootstrap !== undefined) registerRouting(id, mlsBootstrap.routingId);
                if (!writerRef.current) continue;
                if (kind === 'group') {
                    for (const member of mlsBootstrap?.roster ?? []) {
                        if (member.publicKey === ownPublicKey) continue;
                        const transport = requireEphemonCore().get(member.publicKey, member.serverUrl);
                        bindTransport(id, transport);
                        registerTransport(id, transport);
                    }
                    continue;
                }
                const connection = requireEphemonCore().get(publicKey, serverUrl);
                bindConnection(id, connection);
                newMap.set(id, connection);
                registerTransport(id, connection);
            }
            connectionsRef.current = newMap;
            const restored = stored
                .map(({ id, kind, protocol, publicKey, name, serverUrl, clearedFrontier, mlsBootstrap }) => ({
                    id,
                    kind,
                    protocol,
                    publicKey,
                    name,
                    serverUrl,
                    clearedFrontier,
                    mlsBootstrap,
                }))
                .sort((a, b) => a.id - b.id);
            setConversations(restored);
            setStoredConnections(restored).catch(logger.error);
        },
        [logger, setStoredConnections, bindConnection, bindTransport, registerRouting, registerTransport],
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
            setConversations((previous) => {
                const existing = previous.find((candidate) => candidate.id === id);
                const conversation = existing ?? {
                    id,
                    kind: 'direct' as const,
                    protocol: 'legacy' as const,
                    publicKey: connection.publicKey,
                    name: undefined,
                    serverUrl: connection.serverUrl,
                };
                upsertStoredConnection(conversation).catch(logger.error);
                if (existing !== undefined) return previous;
                return [...previous, conversation].sort((a, b) => a.id - b.id);
            });
        },
        [logger, upsertStoredConnection, bindConnection, bindTransport, registerTransport, replaceTransport],
    );

    const _deleteConversation = useCallback(
        async (id: ConversationId) => {
            if (!connectionsRef.current) return;
            const connection = connectionsRef.current.get(id);
            const stored = conversationListRef.current.find((candidate) => candidate.id === id);
            const peerPublicKey = connection?.publicKey ?? stored?.publicKey;
            if (stored?.kind !== 'group' && peerPublicKey !== undefined && peerPublicKey.length > 0) {
                requireEphemonCore().delete(peerPublicKey);
            }
            connectionsRef.current.delete(id);
            conversationTransportsRef.current.delete(id);
            eventHandlersRef.current.delete(id);
            directMlsBootstrapSessionsRef.current.delete(id);
            directMlsReadyRef.current.delete(id);
            offlineMlsAuthoringRef.current.delete(id);
            directMlsReadyWaitersRef.current.delete(id);
            offlineMlsAuthoringRef.current.delete(id);
            forgetConversation(id);
            disposeChatStore(id);
            setConversations((previous) =>
                previous.filter((conversation) => conversation.id !== id).sort((a, b) => a.id - b.id),
            );
            if (database.isUnlocked()) {
                await database.delete(DB_SLUG_TABLE_CONNECTIONS, id);
                await database.clearMessages(id);
                await database.deleteMlsCheckpoint(id);
            }
        },
        [database],
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
            onIncomingConnection(newConnection);
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
            if (id === undefined || id === null) {
                id = nextConversationId();
            }
            if (dialled) dialledRef.current.add(id);
            _upsertConnection(id, newConnection);
            setActiveConversation(id);
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

    const openGroupTransports = useCallback(
        async (id: ConversationId, roster: ReadonlyArray<{ publicKey: string; serverUrl?: string }>): Promise<void> => {
            const ownPublicKey = requireEphemonCore().publicKey;
            await Promise.all(
                roster.map(async (member) => {
                    if (member.publicKey === ownPublicKey) return;
                    if (directConversationOf(member.publicKey) === undefined) return;
                    const transport = requireEphemonCore().get(member.publicKey, member.serverUrl);
                    registerTransport(id, transport);
                    bindTransport(id, transport);
                    if (transport.state === ConnectionState.Open || transport.state === ConnectionState.Degraded)
                        return;
                    await transport.open().catch(logger.error);
                }),
            );
        },
        [bindTransport, directConversationOf, logger, registerTransport],
    );

    const openConnection = useCallback(
        async (id: ConversationId) => {
            if (!connectionsRef.current || !writerRef.current) return;
            const conversation = conversationListRef.current.find((candidate) => candidate.id === id);
            if (conversation?.kind === 'group') {
                await openGroupTransports(id, conversation.mlsBootstrap?.roster ?? []);
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
            dialledRef.current.add(id);
            await connectionInitializedAwaiter(id);
            await connection.open();
        },
        [bindConnection, connectionInitializedAwaiter, openGroupTransports, registerTransport],
    );

    const addConversationMember = useCallback(
        async (id: ConversationId, publicKey: string, serverUrl?: string): Promise<void> => {
            if (!writerRef.current) return;
            await awaitPendingInvites(id);
            const ready = directMlsReadyRef.current.get(id);
            if (ready === undefined) throw new Error('The conversation is not an established MLS group yet');
            if (ready.membership.ownMemberNumber !== ownerOf(id, ready)) {
                throw new Error('Only the group owner may add a member under the current commit policy');
            }
            const locator = publicKey.trim();
            if (ready.membership.roster.some((member) => member.publicKey === locator)) return;
            const invitee: MlsRosterMember = {
                memberNumber: nextMemberNumber(ready.membership.roster),
                publicKey: locator,
                serverUrl,
            };
            const connection = requireEphemonCore().get(locator, serverUrl);
            const parentHead = await ownCommitHead(id);
            const invites = pendingInvitesRef.current.get(id) ?? new Set<Promise<void>>();
            pendingInvitesRef.current.set(id, invites);
            let resolveInvite = (): void => {};
            const joined = new Promise<void>((resolve) => {
                resolveInvite = () => {
                    invites.delete(joined);
                    resolve();
                };
            });
            invites.add(joined);
            const session = new MlsInviteOwnerSession({
                conversationId: id,
                routingId: ready.routingId,
                membership: ready.membership,
                invitee,
                mls: getMlsWorkerClient(),
                serialize: (task) => runExclusiveCommit(id, task),
                sendToInvitee: (frame) => connection.send(frame),
                sendCommitToMembers: (commit) => {
                    recordCommit(id, commit, parentHead).catch(logger.error);
                    const frame = encodeDirectMlsWireFrame({ kind: 'commit', routingId: ready.routingId, commit });
                    const targets = usableTransports(id).filter((transport) => transport.publicKey !== locator);
                    for (const transport of targets) {
                        transport.send(frame);
                    }
                },
                onInviteeJoined: () => {
                    resolveInvite();
                    const latest = directMlsReadyRef.current.get(id);
                    if (latest !== undefined) sendProfile(id, latest).catch(logger.error);
                },
                onRosterChanged: (roster, epoch) => {
                    const stamped = roster.map((member) =>
                        member.publicKey === locator ? { ...member, joinedEpoch: epoch.toString() } : member,
                    );
                    const membership: DirectMlsMembership = { ...ready.membership, roster: stamped };
                    directMlsReadyRef.current.set(id, { ...ready, epoch, membership });
                    persistMlsRoster(id, membership, epoch, ready.routingId);
                    renameGroupFromRoster(id, stamped);
                },
            });
            inviteOwnerSessionsRef.current.set(inviteSessionKey(id, locator), session);
            registerTransport(id, connection);
            bindTransport(id, connection);
            if (connection.state === ConnectionState.Open || connection.state === ConnectionState.Degraded) {
                session.invite();
            } else {
                connection.open().catch(logger.error);
            }
        },
        [
            awaitPendingInvites,
            bindTransport,
            getMlsWorkerClient,
            sendProfile,
            logger,
            ownCommitHead,
            ownerOf,
            persistMlsRoster,
            recordCommit,
            registerTransport,
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
            const groupId = crypto.getRandomValues(new Uint8Array(ROUTING_ID_BYTES));
            const id = createGroupConversation(routingId, name);
            const owner = toMemberNumber(0);
            const membership: DirectMlsMembership = {
                role: 'creator',
                ownMemberNumber: owner,
                peerMemberNumber: owner,
                owner,
                roster: [{ memberNumber: owner, publicKey: ownPublicKey, name: ownName }],
            };
            const mls = getMlsWorkerClient();
            await mls.initialize(id, owner);
            await mls.createGroup(
                id,
                groupId,
                encodeDirectMlsBootstrapFrame({ kind: 'initialize', routingId, groupId }),
            );
            const epoch = (await mls.inspect(id)).epoch ?? 0n;
            directMlsReadyRef.current.set(id, { routingId, epoch, membership });
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
            const cached = offlineMlsAuthoringRef.current.get(id);
            if (cached !== undefined) return cached;
            const stored = (await getStoredConnections()).find((connection) => connection.id === id);
            const bootstrap = stored?.protocol === 'mls' ? stored.mlsBootstrap : undefined;
            if (bootstrap === undefined) return undefined;
            const authoring: DirectMlsBootstrapResult = {
                routingId: Uint8Array.from(bootstrap.routingId),
                epoch: BigInt(bootstrap.epoch),
                membership: {
                    role: bootstrap.owner === bootstrap.ownMemberNumber ? 'creator' : 'invitee',
                    ownMemberNumber: bootstrap.ownMemberNumber,
                    peerMemberNumber: bootstrap.peerMemberNumber,
                    owner: bootstrap.owner,
                    roster: (bootstrap.roster ?? []).map((member) => ({
                        memberNumber: toMemberNumber(member.memberNumber),
                        publicKey: member.publicKey,
                        serverUrl: member.serverUrl,
                        joinedEpoch: member.joinedEpoch,
                        name: member.name,
                    })),
                },
            };
            await getMlsWorkerClient().initialize(id, bootstrap.ownMemberNumber);
            offlineMlsAuthoringRef.current.set(id, authoring);
            return authoring;
        },
        [getMlsWorkerClient, getStoredConnections],
    );

    const authorAndSendMlsEvent = useCallback(
        async (
            id: ConversationId,
            ready: DirectMlsBootstrapResult,
            operation: Exclude<ChatOperation, { kind: 'sync' }>,
        ): Promise<ChatEventRecord | undefined> => {
            const stored = getMlsWorkerClient().getCheckpointChain(id);
            const chain = stored === undefined ? { sequence: 0 } : decodeChatChainState(stored);
            const authored = await authorChatEvent(
                operation,
                chain,
                ready.membership,
                observedHybridLogicalTime(id),
                serverTime(),
                ready.epoch,
            );
            await sendMlsEventBytes(
                id,
                ready.routingId,
                authored.bytes,
                operation.kind === 'typing' ? undefined : authored.chain,
            );
            return authored.record;
        },
        [getMlsWorkerClient, sendMlsEventBytes],
    );

    const sendMessage = useCallback(
        async (id: ConversationId, operation: ChatOperation): Promise<ChatEventRecord | undefined> => {
            if (!connectionsRef.current || !writerRef.current) return undefined;
            const group = conversationListRef.current.find((candidate) => candidate.id === id)?.kind === 'group';
            if (group) {
                await reconcileRef.current.get(id);
                await rekeyRef.current.get(id);
                const live = usableTransports(id).length > 0;
                if (operation.kind === 'typing' && !live) return undefined;
                if (operation.kind !== 'typing') await awaitPendingInvites(id);
                const ready = directMlsReadyRef.current.get(id) ?? (await restoreGroupMls(id));
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
            if (operation.kind !== 'typing') {
            }
            if (isSelfChatConnection(connection)) {
                const authored = toSelfChatUpdate(operation);
                if (usable) connection.send(encodeSelfChatMessage(JSON.stringify(authored.update)));
                return authored.record;
            }
            if (operation.kind === 'typing') {
                if (!usable) return undefined;
                const ready = directMlsReadyRef.current.get(id);
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
            awaitPendingInvites,
            resolveOfflineMlsAuthoring,
            restoreGroupMls,
            sendInventory,
            usableTransports,
            waitForDirectMls,
        ],
    );

    const saveHistory = useCallback(
        async (id: ConversationId, upserts: ReadonlyArray<ChatEventRecord>, deletes: ReadonlyArray<string>) => {
            if (!unlocked || !writerRef.current) return;
            await database.putMessages(id, upserts, deletes);
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
            if (!writerRef.current) return;
            const stored = await database.getMessages(id);
            const known = new Map(stored.map((record) => [record.id, record]));
            for (const record of records) known.set(record.id, record);
            const frontier = computeChatFrontier([...known.values()], clearedFrontierOf(id));
            const cleared = frontier
                .filter((entry) => entry.contiguous >= 0)
                .map((entry) => ({ author: Number(entry.author), through: entry.contiguous }));
            if (cleared.length > 0) {
                setConversations((previous) => {
                    const updated = previous.map((conversation) =>
                        conversation.id === id ? { ...conversation, clearedFrontier: cleared } : conversation,
                    );
                    const changed = updated.find((conversation) => conversation.id === id);
                    if (changed !== undefined) upsertStoredConnection(changed).catch(logger.error);
                    return updated;
                });
            }
            await database.clearMessages(id);
            publishHistoryChange({ id, cleared: true });
        },
        [unlocked, database, clearedFrontierOf, logger, upsertStoredConnection],
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
            setConversations((previous) => {
                const updated = previous.map((conversation) =>
                    conversation.id === id ? { ...conversation, name: value } : conversation,
                );
                const renamed = updated.find((conversation) => conversation.id === id);
                if (renamed !== undefined) upsertStoredConnection(renamed).catch(logger.error);
                return updated;
            });
        },
        [upsertStoredConnection],
    );

    const setOnProgress = useCallback(
        (id: ConversationId, onProgress: (progress: number) => void) => {
            const handlers = eventHandlersRef.current.get(id) ?? {};
            handlers.onProgress = onProgress;
            eventHandlersRef.current.set(id, handlers);
            const connection = connectionsRef.current?.get(id);
            if (connection !== undefined) connection.onProgress = onProgress;
            assertConnectionInitialized(id);
        },
        [assertConnectionInitialized],
    );

    const setOnStateChanged = useCallback(
        (id: ConversationId, onStateChanged: (from: ConnectionState, to: ConnectionState) => void) => {
            const handlers = eventHandlersRef.current.get(id) ?? {};
            handlers.onStateChanged = onStateChanged;
            eventHandlersRef.current.set(id, handlers);
            const connection = connectionsRef.current?.get(id);
            if (connection !== undefined) {
                attachConnectionEventHandlers(id, connection);
            }
            assertConnectionInitialized(id);
        },
        [assertConnectionInitialized, attachConnectionEventHandlers],
    );

    const setOnEvent = useCallback(
        (id: ConversationId, onEvent: (event: InboundChatEvent) => void) => {
            const handlers = eventHandlersRef.current.get(id) ?? {};
            handlers.onEvent = onEvent;
            eventHandlersRef.current.set(id, handlers);
            const connection = connectionsRef.current?.get(id);
            if (connection !== undefined) {
                attachConnectionEventHandlers(id, connection);
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
