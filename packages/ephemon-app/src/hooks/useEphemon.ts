import { disposeChatStore } from '../lib/chatStore';
import {
    forgetConnection,
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
import { ChatWindowMessageType } from '../types/chatMessageType';
import { now } from '../utils/functions';
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
        open: (id: number) => Promise<void>;
        delete: (id: number) => Promise<void>;
    };
    view: {
        setOrder: (id: number, value: number) => void;
        setName: (id: number, value: string | undefined) => void;
    };
    messaging: {
        send: (id: number, message: string) => void;
        history: {
            get: (id: number) => Promise<Array<ChatWindowMessageType>>;
            save: (
                id: number,
                upserts: ReadonlyArray<ChatWindowMessageType>,
                deletes: ReadonlyArray<string>,
            ) => Promise<void>;
            clear: (id: number) => Promise<void>;
        };
    };
    events: {
        setOnProgress: (id: number, onProgress: (progress: number) => void) => void;
        setOnStateChanged: (id: number, onStateChanged: (from: ConnectionState, to: ConnectionState) => void) => void;
        setOnMessage: (id: number, onMessage: (message: string) => void) => void;
    };
};

export type EphemonHookConnection = {
    id: number;
    publicKey: string;
    name: string | undefined;
    serverUrl: string | undefined;
};

export type EphemonHookConnections = {
    available: Array<EphemonHookConnection>;
    create: (publicKey: string, serverUrl?: string) => number;
    callbacks: EphemonHookConnectionCallbacks;
};

type EphemonHook = [string | undefined, EphemonHookMetadata, EphemonHookConnections];

export function useEphemon(
    passwordState: EphemonHookMetadataPasswordState,
    onPermissionDefault: () => Promise<void>,
    onPermissionGranted: () => Promise<void>,
    onPermissionDenied: () => Promise<void>,
    focusOnDial: (publicKey: string) => Promise<boolean>,
    requestDial: (publicKey: string, alreadyExists: boolean) => Promise<boolean>,
    onIncomingConnection: (connection: Connection) => void,
    onConnectionStateChanged: (connection: Connection, from: ConnectionState, to: ConnectionState) => void,
    onConnectionTransportChanged: (connection: Connection, transport: ConnectionTransport) => void,
    onConnectionError: (connection: Connection, error: ConnectionError) => void,
): EphemonHook {
    const [publicKey, setPublicKey] = useState<string | undefined>();

    const logger = getLogger();

    const ephemonPrototype = useMemo<EphemonPrototype>(() => getPrototype(logger), [logger]);

    type DB_KEYS_TYPE = [number[], number[]];
    type DB_CONNECTIONS_TYPE = {
        publicKey: string;
        order: number;
        name: string | undefined;
        serverUrl: string | undefined;
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
            id: number;
            publicKey: string;
            name: string | undefined;
            serverUrl: string | undefined;
            order: number;
        }>
    > => {
        if (unlocked) {
            const connections = await database.getAll<DB_CONNECTIONS_TYPE>(DB_SLUG_TABLE_CONNECTIONS);
            return connections.map((connection) => ({
                id: Number(connection.id),
                publicKey: connection.value.publicKey,
                name: connection.value.name,
                serverUrl: connection.value.serverUrl,
                order: connection.value.order,
            }));
        }
        return [];
    }, [unlocked, database]);

    const upsertStoredConnection = useCallback(
        async (connection: EphemonHookConnection) => {
            const data = {
                publicKey: connection.publicKey,
                name: connection.name,
                serverUrl: connection.serverUrl,
                order: getConversationOrder(connection.publicKey),
            };
            if (unlocked) {
                await database.set<DB_CONNECTIONS_TYPE>(DB_SLUG_TABLE_CONNECTIONS, connection.id, data);
            }
        },
        [unlocked, database],
    );

    const setStoredConnections = useCallback(
        async (values: Array<EphemonHookConnection>) => {
            if (unlocked) {
                await database.clear(DB_SLUG_TABLE_CONNECTIONS);
                for (const value of values) {
                    const data = {
                        publicKey: value.publicKey,
                        name: value.name,
                        serverUrl: value.serverUrl,
                        order: getConversationOrder(value.publicKey),
                    };
                    await database.set<DB_CONNECTIONS_TYPE>(DB_SLUG_TABLE_CONNECTIONS, value.id, data);
                }
            }
        },
        [unlocked, database],
    );

    const [connections, setConnections] = useState<Array<EphemonHookConnection>>([]);
    const connectionsRef = useRef<Map<number, Connection> | undefined>(undefined);
    const connectionListRef = useRef<Array<EphemonHookConnection>>(connections);
    connectionListRef.current = connections;

    const deleteChatRef = useRef<(id: number, connection: Connection) => void>(() => {});

    const bindConnection = useCallback(
        (id: number, connection: Connection) => {
            connection.onError = (error: ConnectionError) => onConnectionError(connection, error);
            connection.onClosedByPeer = () => deleteChatRef.current(id, connection);
            connection.onServerUrlChanged = (serverUrl: string) => {
                setConnections((prevConnections) => {
                    const newConnections = prevConnections.map((candidate) =>
                        candidate.id === id ? { ...candidate, serverUrl } : candidate,
                    );
                    const updated = newConnections.find((candidate) => candidate.id === id);
                    if (updated !== undefined) upsertStoredConnection(updated).catch(logger.error);
                    return newConnections;
                });
            };
        },
        [logger, upsertStoredConnection, onConnectionError],
    );

    const _initConnections = useCallback(
        (
            stored: Array<{
                id: number;
                publicKey: string;
                name: string | undefined;
                serverUrl: string | undefined;
                order: number;
            }>,
        ) => {
            const newMap = new Map<number, Connection>();
            for (const { id, publicKey, serverUrl, order } of stored) {
                const connection = requireEphemonCore().get(publicKey, serverUrl);
                bindConnection(id, connection);
                newMap.set(id, connection);
                setConversationOrder(publicKey, order);
            }
            connectionsRef.current = newMap;
            const restored = stored
                .map(({ id, publicKey, name, serverUrl }) => ({ id, publicKey, name, serverUrl }))
                .sort((a, b) => a.id - b.id);
            setConnections(restored);
            setStoredConnections(restored).catch(logger.error);
        },
        [logger, setStoredConnections, bindConnection],
    );

    const _upsertConnection = useCallback(
        (id: number, connection: Connection) => {
            if (!connectionsRef.current) return;
            bindConnection(id, connection);
            connectionsRef.current.set(id, connection);
            if (getConversationOrder(connection.publicKey) === 0) {
                setConversationOrder(connection.publicKey, now());
            }
            setConnections((prevConnections) => {
                const existing = prevConnections.find((candidate) => candidate.id === id);
                const newConnection = existing ?? {
                    id,
                    publicKey: connection.publicKey,
                    name: undefined,
                    serverUrl: connection.serverUrl,
                };
                upsertStoredConnection(newConnection).catch(logger.error);
                if (existing !== undefined) return prevConnections;
                return [...prevConnections, newConnection].sort((a, b) => a.id - b.id);
            });
        },
        [logger, upsertStoredConnection, bindConnection],
    );

    const _deleteConnection = useCallback(
        async (id: number, connection: Connection) => {
            if (!connectionsRef.current) return;
            requireEphemonCore().delete(connection.publicKey);
            connectionsRef.current.delete(id);
            forgetConnection(connection.publicKey);
            disposeChatStore(connection.publicKey);
            setConnections((prevConnections) =>
                prevConnections.filter((connection) => connection.id !== id).sort((a, b) => a.id - b.id),
            );
            if (database.isUnlocked()) {
                await database.delete(DB_SLUG_TABLE_CONNECTIONS, id);
                await database.clearMessages(id);
            }
        },
        [database],
    );

    const _deleteChat = useCallback(
        (id: number, connection: Connection) => {
            _deleteConnection(id, connection).catch(logger.error);
            if (getActiveConversation() === id) setActiveConversation(undefined);
        },
        [logger, _deleteConnection],
    );
    deleteChatRef.current = _deleteChat;

    const [unstable, setUnstable] = useState<[boolean, string | undefined]>([false, undefined]);

    const [needUpdate, setNeedUpdate] = useState<boolean>(false);

    const resolveConnectionInitializedAwaiterRef = useRef<{ [id: number]: () => void }>({});
    const assertConnectionInitialized = useCallback((id: number) => {
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
        const resolve = resolveConnectionInitializedAwaiterRef.current[id];
        if (validState && resolve !== undefined && resolve !== null) {
            resolve();
        }
        return validState;
    }, []);
    const connectionInitializedAwaiter = useCallback(
        async (id: number) => {
            if (assertConnectionInitialized(id)) return;
            await new Promise<void>((resolve) => {
                resolveConnectionInitializedAwaiterRef.current[id] = resolve;
            });
        },
        [assertConnectionInitialized],
    );
    const onConnection = useCallback(
        (newConnection: Connection) => {
            if (!connectionsRef.current) return -1;
            onIncomingConnection(newConnection);
            let [id, connection] = [...connectionsRef.current].find(
                ([, connection]) => connection.publicKey === newConnection.publicKey,
            ) || [undefined, undefined];
            if (
                connection !== undefined &&
                connection !== null &&
                connection.publicKey !== newConnection.publicKey &&
                connection.state !== ConnectionState.Closed
            ) {
                connection.close();
            }
            if (id === undefined || id === null) {
                const existingIds = [...connectionsRef.current.keys()];
                if (existingIds.length > 0) {
                    id = Math.max(...existingIds) + 1;
                } else {
                    id = 0;
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
        async (id: number) => {
            if (!connectionsRef.current) return;
            const connection = connectionsRef.current.get(id);
            await connectionInitializedAwaiter(id);
            if (connection === undefined || connection === null) {
                return;
            }
            await connection.open();
        },
        [connectionInitializedAwaiter],
    );

    const deleteConnection = useCallback(
        async (id: number) => {
            if (!connectionsRef.current) return;
            const connection = connectionsRef.current.get(id);
            if (connection !== undefined && connection !== null) {
                connection.close();
                _deleteChat(id, connection);
            }
            if (getActiveConversation() === id) setActiveConversation(undefined);
        },
        [_deleteChat],
    );

    const sendMessage = useCallback((id: number, message: string) => {
        if (!connectionsRef.current) return;
        const connection = connectionsRef.current.get(id);
        if (
            connection === undefined ||
            connection === null ||
            (connection.state !== ConnectionState.Open && connection.state !== ConnectionState.Degraded)
        ) {
            return;
        }
        connection.send(message);
    }, []);

    const saveHistory = useCallback(
        async (id: number, upserts: ReadonlyArray<ChatWindowMessageType>, deletes: ReadonlyArray<string>) => {
            if (unlocked) {
                await database.putMessages(id, upserts, deletes);
            }
        },
        [unlocked, database],
    );

    const getHistory = useCallback(
        async (id: number): Promise<Array<ChatWindowMessageType>> => {
            if (unlocked) {
                return await database.getMessages(id);
            }
            return [];
        },
        [unlocked, database],
    );

    const clearHistory = useCallback(
        async (id: number) => {
            if (unlocked) {
                await database.clearMessages(id);
            }
        },
        [unlocked, database],
    );

    const setConnectionOrder = useCallback(
        (id: number, value: number) => {
            const connection = connectionsRef.current?.get(id);
            if (connection === undefined) return;
            setConversationOrder(connection.publicKey, value);
            const known = connectionListRef.current.find((candidate) => candidate.id === id);
            upsertStoredConnection({
                id,
                publicKey: connection.publicKey,
                name: known?.name,
                serverUrl: known?.serverUrl ?? connection.serverUrl,
            }).catch(logger.error);
        },
        [logger, upsertStoredConnection],
    );

    const setConnectionName = useCallback(
        (id: number, value: string | undefined) => {
            setConnections((prevConnections) => {
                const newConnections = prevConnections.map((connection) =>
                    connection.id === id ? { ...connection, name: value } : connection,
                );
                const renamed = newConnections.find((connection) => connection.id === id);
                if (renamed !== undefined) upsertStoredConnection(renamed).catch(logger.error);
                return newConnections;
            });
        },
        [upsertStoredConnection],
    );

    const setOnProgress = useCallback(
        (id: number, onProgress: (progress: number) => void) => {
            if (!connectionsRef.current) return;
            const connection = connectionsRef.current.get(id);
            if (connection === undefined || connection === null) {
                return;
            }
            connection.onProgress = onProgress;
            assertConnectionInitialized(id);
        },
        [assertConnectionInitialized],
    );

    const setOnStateChanged = useCallback(
        (id: number, onStateChanged: (from: ConnectionState, to: ConnectionState) => void) => {
            if (!connectionsRef.current) return;
            const connection = connectionsRef.current.get(id);
            if (connection === undefined || connection === null) {
                return;
            }
            connection.onStateChanged = (from, to) => {
                onConnectionStateChanged(connection, from, to);
                onStateChanged(from, to);
            };
            connection.onTransportChanged = (transport) => onConnectionTransportChanged(connection, transport);
            onConnectionStateChanged(connection, connection.state, connection.state);
            if (connection.transport !== undefined) {
                onConnectionTransportChanged(connection, connection.transport);
            }
            assertConnectionInitialized(id);
        },
        [onConnectionStateChanged, onConnectionTransportChanged, assertConnectionInitialized],
    );

    const setOnMessage = useCallback(
        (id: number, onMessage: (message: string) => void) => {
            if (!connectionsRef.current) return;
            const connection = connectionsRef.current.get(id);
            if (connection === undefined || connection === null) {
                return;
            }
            connection.onMessage = onMessage;
            assertConnectionInitialized(id);
        },
        [assertConnectionInitialized],
    );

    const metadata = useMemo<EphemonHookMetadata>(
        () => ({ needUpdate, unstable, password: passwordState }),
        [needUpdate, unstable, passwordState],
    );

    const callbacks = useMemo<EphemonHookConnectionCallbacks>(
        () => ({
            lifecycle: { open: openConnection, delete: deleteConnection },
            view: { setOrder: setConnectionOrder, setName: setConnectionName },
            messaging: {
                send: sendMessage,
                history: { get: getHistory, save: saveHistory, clear: clearHistory },
            },
            events: { setOnProgress, setOnStateChanged, setOnMessage },
        }),
        [
            openConnection,
            deleteConnection,
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

    const connectionsValue = useMemo<EphemonHookConnections>(
        () => ({ available: connections, create: createConnection, callbacks }),
        [connections, createConnection, callbacks],
    );

    return useMemo(() => [publicKey, metadata, connectionsValue], [publicKey, metadata, connectionsValue]);
}
