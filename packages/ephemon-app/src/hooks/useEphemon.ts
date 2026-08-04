import { disposeChatStore } from '../lib/chatStore';
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
import { getSettings } from '../lib/settingsStore';
import { DB_SLUG_TABLE_CONNECTIONS, DB_SLUG_TABLE_KEYS, getVault } from '../lib/vault';
import { DirectMlsBootstrapResult, DirectMlsBootstrapSession } from '../mls/DirectMlsBootstrapSession';
import { MlsWorkerClient } from '../mls/MlsWorkerClient';
import { decodeDirectMlsChatUpdate, encodeDirectMlsChatUpdate } from '../mls/directApplicationProtocol';
import {
    assignDirectMlsMembership,
    encodeDirectMlsWireFrame,
    tryDecodeDirectMlsWireFrame,
} from '../mls/directBootstrapProtocol';
import { createVaultMlsCheckpointStore } from '../mls/mlsCheckpointStore';
import { ChatWindowMessageType } from '../types/chatMessageType';
import { ConversationId, MemberNumber, toConversationId } from '../types/conversation';
import { now } from '../utils/functions';
import { decodeLegacyTextMessage, encodeLegacyTextMessage } from '../utils/legacyTextConnection';
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
};

export type EphemonHookConnectionCallbacks = {
    lifecycle: {
        open: (id: ConversationId) => Promise<void>;
        delete: (id: ConversationId) => Promise<void>;
    };
    view: {
        setOrder: (id: ConversationId, value: number) => void;
        setName: (id: ConversationId, value: string | undefined) => void;
    };
    messaging: {
        send: (id: ConversationId, message: string, options?: { ephemeral?: boolean }) => Promise<void>;
        history: {
            get: (id: ConversationId) => Promise<Array<ChatWindowMessageType>>;
            save: (
                id: ConversationId,
                upserts: ReadonlyArray<ChatWindowMessageType>,
                deletes: ReadonlyArray<string>,
            ) => Promise<void>;
            clear: (id: ConversationId) => Promise<void>;
        };
    };
    events: {
        setOnProgress: (id: ConversationId, onProgress: (progress: number) => void) => void;
        setOnStateChanged: (
            id: ConversationId,
            onStateChanged: (from: ConnectionState, to: ConnectionState) => void,
        ) => void;
        setOnMessage: (id: ConversationId, onMessage: (message: string) => void) => void;
    };
};

export type EphemonHookConversation = {
    id: ConversationId;
    kind: 'direct';
    protocol: 'legacy' | 'mls';
    publicKey: string;
    name: string | undefined;
    serverUrl: string | undefined;
    mlsBootstrap?: {
        version: 1;
        routingId: ReadonlyArray<number>;
        epoch: string;
        owner: MemberNumber;
        ownMemberNumber: MemberNumber;
        peerMemberNumber: MemberNumber;
    };
};

export type EphemonHookConversations = {
    available: Array<EphemonHookConversation>;
    create: (publicKey: string, serverUrl?: string) => ConversationId | undefined;
    callbacks: EphemonHookConnectionCallbacks;
};

type EphemonHook = [string | undefined, EphemonHookMetadata, EphemonHookConversations];

function isSelfChatConnection(connection: Connection): boolean {
    return connection.publicKey === requireEphemonCore().publicKey;
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

    const logger = getLogger();

    const ephemonPrototype = useMemo<EphemonPrototype>(() => getPrototype(logger), [logger]);

    type DB_KEYS_TYPE = [number[], number[]];
    type DB_CONNECTIONS_TYPE = {
        kind?: 'direct';
        protocol?: 'legacy' | 'mls';
        publicKey: string;
        order: number;
        name: string | undefined;
        serverUrl: string | undefined;
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
            kind: 'direct';
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
                kind: 'direct' as const,
                protocol: connection.value.protocol === 'mls' ? ('mls' as const) : ('legacy' as const),
                publicKey: connection.value.publicKey,
                name: connection.value.name,
                serverUrl: connection.value.serverUrl,
                order: connection.value.order,
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
                        mlsBootstrap: value.mlsBootstrap,
                    };
                    await database.set<DB_CONNECTIONS_TYPE>(DB_SLUG_TABLE_CONNECTIONS, value.id, data);
                }
            }
        },
        [unlocked, database],
    );

    const [conversations, setConversations] = useState<Array<EphemonHookConversation>>([]);
    const connectionsRef = useRef<Map<ConversationId, Connection> | undefined>(undefined);
    const conversationListRef = useRef<Array<EphemonHookConversation>>(conversations);
    conversationListRef.current = conversations;

    type ConnectionEventHandlers = {
        onProgress?: (progress: number) => void;
        onStateChanged?: (from: ConnectionState, to: ConnectionState) => void;
        onMessage?: (message: string) => void;
    };
    const eventHandlersRef = useRef<Map<ConversationId, ConnectionEventHandlers>>(new Map());
    const explicitPeerCloseRef = useRef<(id: ConversationId) => void>(() => {});
    const mlsWorkerClientRef = useRef<MlsWorkerClient | undefined>(undefined);
    const directMlsBootstrapSessionsRef = useRef<Map<ConversationId, DirectMlsBootstrapSession>>(new Map());
    const directMlsReadyRef = useRef<Map<ConversationId, DirectMlsBootstrapResult>>(new Map());
    const directMlsReadyWaitersRef = useRef<Map<ConversationId, Set<(result: DirectMlsBootstrapResult) => void>>>(
        new Map(),
    );

    useEffect(() => {
        if (!unlocked) {
            directMlsBootstrapSessionsRef.current.clear();
            directMlsReadyRef.current.clear();
            directMlsReadyWaitersRef.current.clear();
            mlsWorkerClientRef.current?.close();
            mlsWorkerClientRef.current = undefined;
            return;
        }
        return () => {
            directMlsBootstrapSessionsRef.current.clear();
            directMlsReadyRef.current.clear();
            directMlsReadyWaitersRef.current.clear();
            mlsWorkerClientRef.current?.close();
            mlsWorkerClientRef.current = undefined;
        };
    }, [unlocked]);

    const getMlsWorkerClient = useCallback((): MlsWorkerClient => {
        if (!database.isUnlocked()) throw new Error('Cannot start MLS while the vault is locked');
        const existing = mlsWorkerClientRef.current;
        if (existing !== undefined) return existing;
        const created = new MlsWorkerClient(createVaultMlsCheckpointStore(database));
        mlsWorkerClientRef.current = created;
        return created;
    }, [database]);

    const startDirectMlsBootstrap = useCallback(
        async (id: ConversationId, connection: Connection): Promise<DirectMlsBootstrapSession> => {
            let session = directMlsBootstrapSessionsRef.current.get(id);
            if (session === undefined) {
                const ownPublicKey = requireEphemonCore().publicKey;
                if (ownPublicKey === undefined)
                    throw new Error('Cannot elect direct MLS members before login completes');
                session = new DirectMlsBootstrapSession({
                    conversationId: id,
                    membership: assignDirectMlsMembership(ownPublicKey, connection.publicKey),
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
                                              owner:
                                                  membership.role === 'creator'
                                                      ? membership.ownMemberNumber
                                                      : membership.peerMemberNumber,
                                              ownMemberNumber: membership.ownMemberNumber,
                                              peerMemberNumber: membership.peerMemberNumber,
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
                directMlsBootstrapSessionsRef.current.set(id, session);
            }
            await session.start();
            return session;
        },
        [getMlsWorkerClient, logger, upsertStoredConnection],
    );

    const waitForDirectMls = useCallback(
        async (id: ConversationId, connection: Connection): Promise<DirectMlsBootstrapResult> => {
            const ready = directMlsReadyRef.current.get(id);
            if (ready !== undefined) return ready;
            const completion = new Promise<DirectMlsBootstrapResult>((resolve) => {
                let waiters = directMlsReadyWaitersRef.current.get(id);
                if (waiters === undefined) {
                    waiters = new Set();
                    directMlsReadyWaitersRef.current.set(id, waiters);
                }
                waiters.add(resolve);
            });
            await startDirectMlsBootstrap(id, connection);
            return directMlsReadyRef.current.get(id) ?? completion;
        },
        [startDirectMlsBootstrap],
    );

    const handleConnectionMessage = useCallback(
        async (id: ConversationId, connection: Connection, message: Uint8Array): Promise<void> => {
            if (isSelfChatConnection(connection)) {
                const handler = eventHandlersRef.current.get(id)?.onMessage;
                if (handler !== undefined) handler(decodeLegacyTextMessage(message));
                return;
            }
            const frame = tryDecodeDirectMlsWireFrame(message);
            if (frame?.kind === 'application') {
                const ready = await waitForDirectMls(id, connection);
                if (
                    ready.routingId.byteLength !== frame.routingId.byteLength ||
                    !ready.routingId.every((value, index) => value === frame.routingId[index])
                ) {
                    throw new Error('MLS application frame routing ID does not match the direct conversation');
                }
                const processed = await getMlsWorkerClient().processApplicationMessage(id, frame.message);
                try {
                    if (processed.senderMemberNumber !== ready.membership.peerMemberNumber) {
                        throw new Error('MLS application message was not authored by the direct peer');
                    }
                    const handler = eventHandlersRef.current.get(id)?.onMessage;
                    if (handler !== undefined) handler(decodeDirectMlsChatUpdate(processed.payload));
                } finally {
                    processed.payload.fill(0);
                }
                return;
            }
            if (frame !== undefined) {
                const session = await startDirectMlsBootstrap(id, connection);
                await session.receive(message);
                return;
            }
            throw new Error('Direct conversation received an unsupported non-MLS link frame');
        },
        [getMlsWorkerClient, startDirectMlsBootstrap, waitForDirectMls],
    );

    const handleConnectionStateChanged = useCallback(
        (id: ConversationId, connection: Connection, from: ConnectionState, to: ConnectionState) => {
            onConnectionStateChanged(id, connection, from, to);
            eventHandlersRef.current.get(id)?.onStateChanged?.(from, to);
            if (!isSelfChatConnection(connection) && (to === ConnectionState.Open || to === ConnectionState.Degraded)) {
                const session = directMlsBootstrapSessionsRef.current.get(id);
                if (session === undefined) {
                    startDirectMlsBootstrap(id, connection).catch(logger.error);
                } else if (from !== ConnectionState.Open && from !== ConnectionState.Degraded) {
                    session.linkOpened().catch(logger.error);
                }
            }
        },
        [logger, onConnectionStateChanged, startDirectMlsBootstrap],
    );

    const attachConnectionEventHandlers = useCallback(
        (id: ConversationId, connection: Connection) => {
            const handlers = eventHandlersRef.current.get(id);
            connection.onProgress = handlers?.onProgress;
            connection.onStateChanged = (from, to) => handleConnectionStateChanged(id, connection, from, to);
            connection.onTransportChanged = (transport) => onConnectionTransportChanged(id, connection, transport);
            connection.onMessage = (message) => {
                handleConnectionMessage(id, connection, message).catch(logger.error);
            };

            handleConnectionStateChanged(id, connection, connection.state, connection.state);
            if (connection.transport !== undefined) {
                onConnectionTransportChanged(id, connection, connection.transport);
            }
        },
        [handleConnectionMessage, handleConnectionStateChanged, logger, onConnectionTransportChanged],
    );

    const bindConnection = useCallback(
        (id: ConversationId, connection: Connection) => {
            directMlsBootstrapSessionsRef.current.delete(id);
            directMlsReadyRef.current.delete(id);
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

    const _initConnections = useCallback(
        (stored: Array<EphemonHookConversation & { order: number }>) => {
            const newMap = new Map<ConversationId, Connection>();
            for (const { id, publicKey, serverUrl, order } of stored) {
                const connection = requireEphemonCore().get(publicKey, serverUrl);
                bindConnection(id, connection);
                newMap.set(id, connection);
                setConversationOrder(id, order);
            }
            connectionsRef.current = newMap;
            const restored = stored
                .map(({ id, kind, protocol, publicKey, name, serverUrl, mlsBootstrap }) => ({
                    id,
                    kind,
                    protocol,
                    publicKey,
                    name,
                    serverUrl,
                    mlsBootstrap,
                }))
                .sort((a, b) => a.id - b.id);
            setConversations(restored);
            setStoredConnections(restored).catch(logger.error);
        },
        [logger, setStoredConnections, bindConnection],
    );

    const _upsertConnection = useCallback(
        (id: ConversationId, connection: Connection) => {
            if (!connectionsRef.current) return;
            bindConnection(id, connection);
            connectionsRef.current.set(id, connection);
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
        [logger, upsertStoredConnection, bindConnection],
    );

    const _deleteConversation = useCallback(
        async (id: ConversationId) => {
            if (!connectionsRef.current) return;
            const connection = connectionsRef.current.get(id);
            const stored = conversationListRef.current.find((candidate) => candidate.id === id);
            const peerPublicKey = connection?.publicKey ?? stored?.publicKey;
            if (peerPublicKey !== undefined) requireEphemonCore().delete(peerPublicKey);
            connectionsRef.current.delete(id);
            eventHandlersRef.current.delete(id);
            directMlsBootstrapSessionsRef.current.delete(id);
            directMlsReadyRef.current.delete(id);
            directMlsReadyWaitersRef.current.delete(id);
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
        (newConnection: Connection): ConversationId | undefined => {
            if (!connectionsRef.current) return undefined;
            onIncomingConnection(newConnection);
            const attached = [...connectionsRef.current].find(
                ([, connection]) => connection.publicKey === newConnection.publicKey,
            );
            let id =
                attached?.[0] ??
                conversationListRef.current.find((conversation) => conversation.publicKey === newConnection.publicKey)
                    ?.id;
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
                const existingIds = [...connectionsRef.current.keys()];
                if (existingIds.length > 0) {
                    id = toConversationId(Math.max(...existingIds) + 1);
                } else {
                    id = toConversationId(0);
                }
            }
            _upsertConnection(id, newConnection);
            setActiveConversation(id);
            return id;
        },
        [onIncomingConnection, _upsertConnection],
    );

    const [disablePushServiceValue] = useSearchParams('__debug_disable_push_service');

    useEffect(() => {
        if (
            passwordState === 'valid' &&
            signingKeyPair !== undefined &&
            signingKeyPair !== null &&
            ephemonPrototype !== undefined &&
            ephemonPrototype !== null &&
            !hasEphemonCore()
        ) {
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
            const newConnection = requireEphemonCore().get(publicKey.trim(), serverUrl);
            return onConnection(newConnection);
        },
        [onConnection],
    );

    const openConnection = useCallback(
        async (id: ConversationId) => {
            if (!connectionsRef.current) return;
            let connection = connectionsRef.current.get(id);
            if (connection === undefined) {
                const conversation = conversationListRef.current.find((candidate) => candidate.id === id);
                if (conversation === undefined) return;
                connection = requireEphemonCore().get(conversation.publicKey, conversation.serverUrl);
                bindConnection(id, connection);
                connectionsRef.current.set(id, connection);
            }
            await connectionInitializedAwaiter(id);
            await connection.open();
        },
        [bindConnection, connectionInitializedAwaiter],
    );

    const sendMessage = useCallback(
        async (id: ConversationId, message: string, options?: { ephemeral?: boolean }): Promise<void> => {
            if (!connectionsRef.current) return;
            const connection = connectionsRef.current.get(id);
            if (
                connection === undefined ||
                connection === null ||
                (connection.state !== ConnectionState.Open && connection.state !== ConnectionState.Degraded)
            ) {
                return;
            }
            if (isSelfChatConnection(connection)) {
                connection.send(encodeLegacyTextMessage(message));
                return;
            }
            const ready = options?.ephemeral
                ? directMlsReadyRef.current.get(id)
                : await waitForDirectMls(id, connection);
            if (ready === undefined) return;
            const payload = encodeDirectMlsChatUpdate(message);
            let encrypted: Uint8Array;
            try {
                encrypted = await getMlsWorkerClient().createApplicationMessage(id, payload);
            } finally {
                payload.fill(0);
            }
            const current = connectionsRef.current.get(id);
            if (
                current === undefined ||
                (current.state !== ConnectionState.Open && current.state !== ConnectionState.Degraded)
            ) {
                return;
            }
            current.send(
                encodeDirectMlsWireFrame({
                    kind: 'application',
                    routingId: ready.routingId,
                    message: encrypted,
                }),
            );
        },
        [getMlsWorkerClient, waitForDirectMls],
    );

    const saveHistory = useCallback(
        async (id: ConversationId, upserts: ReadonlyArray<ChatWindowMessageType>, deletes: ReadonlyArray<string>) => {
            if (unlocked) {
                await database.putMessages(id, upserts, deletes);
            }
        },
        [unlocked, database],
    );

    const getHistory = useCallback(
        async (id: ConversationId): Promise<Array<ChatWindowMessageType>> => {
            if (unlocked) {
                return await database.getMessages(id);
            }
            return [];
        },
        [unlocked, database],
    );

    const clearHistory = useCallback(
        async (id: ConversationId) => {
            if (unlocked) {
                await database.clearMessages(id);
            }
        },
        [unlocked, database],
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

    const setOnMessage = useCallback(
        (id: ConversationId, onMessage: (message: string) => void) => {
            const handlers = eventHandlersRef.current.get(id) ?? {};
            handlers.onMessage = onMessage;
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
        () => ({ needUpdate, unstable, password: passwordState }),
        [needUpdate, unstable, passwordState],
    );

    const callbacks = useMemo<EphemonHookConnectionCallbacks>(
        () => ({
            lifecycle: { open: openConnection, delete: deleteConversation },
            view: { setOrder: setConnectionOrder, setName: setConnectionName },
            messaging: {
                send: sendMessage,
                history: { get: getHistory, save: saveHistory, clear: clearHistory },
            },
            events: { setOnProgress, setOnStateChanged, setOnMessage },
        }),
        [
            openConnection,
            deleteConversation,
            setConnectionOrder,
            setConnectionName,
            sendMessage,
            getHistory,
            saveHistory,
            clearHistory,
            setOnProgress,
            setOnStateChanged,
            setOnMessage,
        ],
    );

    const conversationsValue = useMemo<EphemonHookConversations>(
        () => ({ available: conversations, create: createConnection, callbacks }),
        [conversations, createConnection, callbacks],
    );

    return useMemo(() => [publicKey, metadata, conversationsValue], [publicKey, metadata, conversationsValue]);
}
