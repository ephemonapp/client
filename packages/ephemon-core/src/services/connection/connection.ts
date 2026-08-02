import { Base64 } from '../../utils/base64';
import { Cryptography } from '../../utils/cryptography';
import { Logger } from '../../utils/logger';
import { newError } from '../../utils/new-error';
import { Utf8 } from '../../utils/utf8';
import { CallService } from '../call-service';
import { CallServiceFactory } from '../call-service-factory';
import { SessionService } from '../session-service';
import { TimeService } from '../time-service';
import { classifyCallError, ConnectionError } from './connection-error';
import { ConnectionSaga, ConnectionSagaState, ConnectionSagaType, getConnectionSaga } from './connection-saga';
import { IceServer } from './ice-server';
import { WebRTC } from './web-rtc';

export enum ConnectionState {
    New = 'new',
    Connecting = 'connecting',
    Open = 'open',
    /** Only one of the two peer connections survived; traffic still flows over it */
    Degraded = 'degraded',
    Closed = 'closed',
}

export type ConnectionTransport = 'direct' | 'relay';

export interface Connection {
    get publicKey(): string;

    get state(): ConnectionState;

    get serverUrl(): string | undefined;

    get onServerUrlChanged(): ((serverUrl: string) => void) | undefined;

    /** Persisting it allows a later session to reach the peer without a contact code. */
    set onServerUrlChanged(onServerUrlChanged: ((serverUrl: string) => void) | undefined);

    get error(): ConnectionError | undefined;

    get onError(): ((error: ConnectionError) => void) | undefined;

    /** Sets the callback fired when a connection attempt stops with something to report, so the reason can be shown instead of an attempt that seems to hang. */
    set onError(onError: ((error: ConnectionError) => void) | undefined);

    open(): Promise<ConnectionInternal>;

    send(message: string): void;

    close(): void;

    get onClosedByPeer(): (() => void) | undefined;

    /** The conversation is over on their side and will not be resumed. */
    set onClosedByPeer(onClosedByPeer: (() => void) | undefined);

    get onProgress(): ((progress: number) => void) | undefined;

    set onProgress(onProgress: ((progress: number) => void) | undefined);

    get onStateChanged(): ((from: ConnectionState, to: ConnectionState) => void) | undefined;

    set onStateChanged(onStateChange: ((from: ConnectionState, to: ConnectionState) => void) | undefined);

    get transport(): ConnectionTransport | undefined;

    get onTransportChanged(): ((transport: ConnectionTransport) => void) | undefined;

    set onTransportChanged(onTransportChanged: ((transport: ConnectionTransport) => void) | undefined);

    get onMessage(): ((message: string) => void) | undefined;

    set onMessage(onMessage: ((message: string) => void) | undefined);
}

export interface ConnectionInternal {
    onProgress?: (progress: number) => void;
    onStateChanged?: (from: ConnectionState, to: ConnectionState) => void;
    onMessage?: (message: string) => void;
    onTransportChanged?: (transport: ConnectionTransport) => void;
    onServerUrlChanged?: (serverUrl: string) => void;
    onError?: (error: ConnectionError) => void;
    onClosedByPeer?: () => void;

    get error(): ConnectionError | undefined;

    get openedAt(): number | undefined;

    get publicKey(): string;

    get state(): ConnectionState;

    /** Gets the transport of the established connection (direct P2P or relay), or undefined until the connection is open and the selected candidate is known. */
    get transport(): ConnectionTransport | undefined;

    get serverUrl(): string | undefined;

    /** Remembers the server the peer is registered on, so that outgoing signaling is routed through it. */
    setServerUrl(serverUrl: string): void;

    get incomingState(): ConnectionSagaState;

    get outgoingState(): ConnectionSagaState;

    send(message: string): void;

    openIncoming(): Promise<ConnectionInternal>;

    openOutgoing(): Promise<ConnectionInternal>;

    close(): void;

    /** Nothing is sent back — the peer is already gone — and the application is told, so it can drop the conversation as well. */
    closeByPeer(): void;

    continueIncoming(): void;

    continueOutgoing(): void;

    setIncomingEncryption(encryptionPublicKeyBase64: string): void;

    setOutgoingEncryption(encryptionPublicKeyBase64: string): void;

    setIncomingDescription(encryptedDataBase64: string): Promise<void>;

    setOutgoingDescription(encryptedDataBase64: string): Promise<void>;

    addIncomingIce(encryptedDataBase64: string): Promise<void>;

    addOutgoingIce(encryptedDataBase64: string): Promise<void>;
}

export function translateConnection(connection: ConnectionInternal): Connection {
    return {
        get publicKey(): string {
            return connection.publicKey;
        },
        get state(): ConnectionState {
            return connection.state;
        },
        get transport(): ConnectionTransport | undefined {
            return connection.transport;
        },
        get onTransportChanged(): ((transport: ConnectionTransport) => void) | undefined {
            return connection.onTransportChanged;
        },
        set onTransportChanged(onTransportChanged: ((transport: ConnectionTransport) => void) | undefined) {
            connection.onTransportChanged = onTransportChanged;
        },
        get serverUrl(): string | undefined {
            return connection.serverUrl;
        },
        get onServerUrlChanged(): ((serverUrl: string) => void) | undefined {
            return connection.onServerUrlChanged;
        },
        set onServerUrlChanged(onServerUrlChanged: ((serverUrl: string) => void) | undefined) {
            connection.onServerUrlChanged = onServerUrlChanged;
        },
        get error(): ConnectionError | undefined {
            return connection.error;
        },
        get onError(): ((error: ConnectionError) => void) | undefined {
            return connection.onError;
        },
        set onError(onError: ((error: ConnectionError) => void) | undefined) {
            connection.onError = onError;
        },
        open(): Promise<ConnectionInternal> {
            return connection.openOutgoing();
        },
        send(message: string) {
            connection.send(message);
        },
        close() {
            connection.close();
        },
        get onClosedByPeer(): (() => void) | undefined {
            return connection.onClosedByPeer;
        },
        set onClosedByPeer(onClosedByPeer: (() => void) | undefined) {
            connection.onClosedByPeer = onClosedByPeer;
        },
        get onProgress(): ((progress: number) => void) | undefined {
            return connection.onProgress;
        },
        set onProgress(onProgress: ((progress: number) => void) | undefined) {
            connection.onProgress = onProgress;
        },
        get onStateChanged(): ((from: ConnectionState, to: ConnectionState) => void) | undefined {
            return connection.onStateChanged;
        },
        set onStateChanged(onStateChange: ((from: ConnectionState, to: ConnectionState) => void) | undefined) {
            connection.onStateChanged = onStateChange;
        },
        get onMessage(): ((message: string) => void) | undefined {
            return connection.onMessage;
        },
        set onMessage(onMessage: ((message: string) => void) | undefined) {
            connection.onMessage = onMessage;
        },
    };
}

function isNegotiating(value: ConnectionSagaState): boolean {
    return value > ConnectionSagaState.New && value < ConnectionSagaState.Connected;
}

export function getConnection(
    publicKey: string,
    logger: Logger,
    timeService: TimeService,
    callServiceFactory: CallServiceFactory,
    sessionService: SessionService,
    base64: Base64,
    utf8: Utf8,
    cryptography: Cryptography,
    webRTC: WebRTC,
    iceServers?: IceServer[],
    serverUrl?: string,
): ConnectionInternal {
    let openedAt: number | undefined;
    let state: ConnectionState = ConnectionState.New;
    let peerServerUrl: string | undefined = serverUrl;
    let connectionCallService: CallService | undefined;
    let openAttempt = 0;
    let error: ConnectionError | undefined;
    let incomingSaga = createConnectionSaga('incoming');
    let outgoingSaga = createConnectionSaga('outgoing');
    const connectedOrder: ConnectionSaga[] = [];

    /** A peer is always reachable on its own server, and reachable on ours only while it holds a guest channel there — which is exactly the case when it was the one who dialed us. */
    function getCallService(): CallService {
        return connectionCallService || callServiceFactory.prime;
    }

    function createConnectionSaga(type: ConnectionSagaType) {
        return getConnectionSaga(
            publicKey,
            type,
            logger,
            timeService,
            getCallService,
            () => callServiceFactory.primeServerUrl,
            sessionService,
            base64,
            utf8,
            cryptography,
            webRTC,
            iceServers,
        );
    }

    function setPeerServerUrl(value: string): void {
        if (!value || value === peerServerUrl) {
            return;
        }
        peerServerUrl = value;
        logger.debug(`[connection] Server URL of ${publicKey} is ${value}.`);
        new Promise<void>((resolve) => {
            connection.onServerUrlChanged?.call(connection, value);
            resolve();
        }).catch((err) => {
            logger.error(`[connection] Server URL callback error in connection with ${publicKey}.`, err);
        });
    }

    function reportError(failure: ConnectionError): void {
        error = failure;
        new Promise<void>((resolve) => {
            connection.onError?.call(connection, failure);
            resolve();
        }).catch((err) => {
            logger.error(`[connection] Failure callback error in connection with ${publicKey}.`, err);
        });
    }

    function connectionOnProgress(progress: number): void {
        new Promise<void>((resolve) => {
            if (connection.onProgress !== undefined && connection.onProgress !== null) {
                connection.onProgress(progress);
            }
            resolve();
        }).catch((err) => {
            logger.error(`[connection] Progress callback error in connection with ${connection.publicKey}.`, err);
        });
    }

    function connectionOnStateChange(from: ConnectionState, to: ConnectionState): void {
        new Promise<void>((resolve) => {
            connection.onStateChanged?.call(connection, from, to);
            resolve();
        }).catch((err) => {
            logger.error(`[connection] State change callback error in connection with ${connection.publicKey}.`, err);
        });
    }

    function connectionOnMessage(message: string) {
        new Promise<void>((resolve) => {
            connection.onMessage?.call(connection, message);
            resolve();
        }).catch((err) => {
            logger.error(`[connection] Message callback error in connection with ${connection.publicKey}.`, err);
        });
    }

    function connectionOnClosedByPeer(): void {
        new Promise<void>((resolve) => {
            connection.onClosedByPeer?.call(connection);
            resolve();
        }).catch((err) => {
            logger.error(`[connection] Closed by peer callback error in connection with ${publicKey}.`, err);
        });
    }

    function getConnectionSagaOnStateChanged(saga: ConnectionSaga) {
        const { type } = saga;
        return (from: ConnectionSagaState, to: ConnectionSagaState) => {
            if (to === ConnectionSagaState.Connected && !connectedOrder.includes(saga)) {
                connectedOrder.push(saga);
            }
            if (to === ConnectionSagaState.Connected) {
                error = undefined;
            }
            const old = state;
            const actual = connection.state;
            if (old !== actual) {
                connectionOnStateChange(old, actual);
                logger.debug(
                    `[connection] State changed in connection with ${connection.publicKey} from ${old} to ${actual}.`,
                );
            }
            if (from !== to) {
                logger.debug(
                    `[connection-saga] State changed in ${type} connection saga with ${connection.publicKey} from ${ConnectionSagaState[from]} to ${ConnectionSagaState[to]}.`,
                );
            }
            const { state: incomingState } = incomingSaga;
            const { state: outgoingState } = outgoingSaga;
            const progress = Math.min(
                Math.ceil((Math.max(incomingState, outgoingState) * 100) / ConnectionSagaState.Connected),
                100,
            );
            logger.debug(`[connection] Progress in connection with ${connection.publicKey}: ${progress}%.`);
            connectionOnProgress(progress);
        };
    }

    function getSaga(): ConnectionSaga | undefined {
        for (const saga of connectedOrder) {
            if (saga.state === ConnectionSagaState.Connected) {
                return saga;
            }
        }
        if (incomingSaga.state === ConnectionSagaState.Connected) {
            return incomingSaga;
        }
        if (outgoingSaga.state === ConnectionSagaState.Connected) {
            return outgoingSaga;
        }
        return undefined;
    }

    async function open(
        incomingInitialState: ConnectionSagaState,
        outgoingInitialState: ConnectionSagaState,
        throughServerUrl: string | undefined,
    ): Promise<void> {
        openedAt = timeService.serverTime;
        const attempt = ++openAttempt;
        let callService: CallService;
        try {
            callService = await callServiceFactory.getForServerUrl(throughServerUrl);
        } catch (failure) {
            reportError(classifyCallError(failure));
            return;
        }
        if (attempt !== openAttempt) {
            logger.debug(
                `[connection] Attempt with ${publicKey} abandoned. The connection was closed or reopened while its server was being resolved.`,
            );
            return;
        }
        connectionCallService = callService;
        const sagas = await Promise.all([
            incomingSaga.open(incomingInitialState),
            outgoingSaga.open(outgoingInitialState),
        ]);
        logger.debug(
            `[connection] Saga states: ${sagas[0].type}=${ConnectionSagaState[sagas[0].state]}; ${sagas[1].type}=${ConnectionSagaState[sagas[1].state]}`,
        );
    }

    incomingSaga.onMessage = connectionOnMessage;
    outgoingSaga.onMessage = connectionOnMessage;
    incomingSaga.onStateChanged = getConnectionSagaOnStateChanged(incomingSaga);
    outgoingSaga.onStateChanged = getConnectionSagaOnStateChanged(outgoingSaga);
    const onSagaTransportChanged = () => {
        const currentTransport = connection.transport;
        if (currentTransport !== undefined) {
            connection.onTransportChanged?.call(connection, currentTransport);
        }
    };
    incomingSaga.onTransportChanged = onSagaTransportChanged;
    outgoingSaga.onTransportChanged = onSagaTransportChanged;
    incomingSaga.onPeerServerUrl = setPeerServerUrl;
    outgoingSaga.onPeerServerUrl = setPeerServerUrl;
    incomingSaga.onFailed = reportError;
    outgoingSaga.onFailed = reportError;

    const connection: ConnectionInternal = {
        get openedAt(): number | undefined {
            return openedAt;
        },
        get publicKey(): string {
            return publicKey;
        },
        get state(): ConnectionState {
            const { state: inState } = incomingSaga;
            const { state: outState } = outgoingSaga;
            const inClosed = inState === ConnectionSagaState.Closed;
            const outClosed = outState === ConnectionSagaState.Closed;
            if (inClosed && outClosed) {
                state = ConnectionState.Closed;
            } else if (inState === ConnectionSagaState.Connected || outState === ConnectionSagaState.Connected) {
                state = inClosed || outClosed ? ConnectionState.Degraded : ConnectionState.Open;
            } else if (inClosed || outClosed) {
                state =
                    isNegotiating(inState) || isNegotiating(outState)
                        ? ConnectionState.Connecting
                        : ConnectionState.Closed;
            } else if (inState === ConnectionSagaState.New && outState === ConnectionSagaState.New) {
                state = ConnectionState.New;
            } else {
                state = ConnectionState.Connecting;
            }
            return state;
        },
        get transport(): ConnectionTransport | undefined {
            return getSaga()?.transport;
        },
        get serverUrl(): string | undefined {
            return peerServerUrl;
        },
        setServerUrl(value: string): void {
            setPeerServerUrl(value);
        },
        get error(): ConnectionError | undefined {
            return error;
        },
        get incomingState() {
            return incomingSaga.state;
        },
        get outgoingState() {
            return outgoingSaga.state;
        },
        onProgress: undefined,
        onStateChanged: undefined,
        onMessage: undefined,
        onClosedByPeer: undefined,
        send(message: string) {
            const saga = getSaga();
            if (!saga) {
                throw newError(logger, '[connection] Connection is not ready yet.');
            }
            saga.send(message);
        },
        async openIncoming(): Promise<ConnectionInternal> {
            await open(ConnectionSagaState.SendOffer, ConnectionSagaState.SendDial, undefined);
            return this;
        },
        async openOutgoing(): Promise<ConnectionInternal> {
            await open(ConnectionSagaState.AwaitDial, ConnectionSagaState.SendDial, peerServerUrl);
            return this;
        },
        close(): void {
            ++openAttempt;
            getCallService().close(sessionService.signingPublicKeyBase64, this.publicKey);
            incomingSaga.abort();
            outgoingSaga.abort();
        },
        /** Nothing is sent back — the peer is already gone — and the application is told, so it can drop the conversation as well. */
        closeByPeer(): void {
            ++openAttempt;
            incomingSaga.abort();
            outgoingSaga.abort();
            connectionOnClosedByPeer();
        },
        continueIncoming(): void {
            incomingSaga.continue();
        },
        continueOutgoing(): void {
            outgoingSaga.continue();
        },
        setIncomingEncryption(encryptionPublicKeyBase64: string): void {
            incomingSaga.setEncryption(encryptionPublicKeyBase64);
        },
        setOutgoingEncryption(encryptionPublicKeyBase64: string): void {
            outgoingSaga.setEncryption(encryptionPublicKeyBase64);
        },
        async setIncomingDescription(encryptedDataBase64: string): Promise<void> {
            await incomingSaga.setDescription(encryptedDataBase64);
        },
        async setOutgoingDescription(encryptedDataBase64: string): Promise<void> {
            await outgoingSaga.setDescription(encryptedDataBase64);
        },
        async addIncomingIce(encryptedDataBase64: string): Promise<void> {
            await incomingSaga.addIceCandidate(encryptedDataBase64);
        },
        async addOutgoingIce(encryptedDataBase64: string): Promise<void> {
            await outgoingSaga.addIceCandidate(encryptedDataBase64);
        },
    };
    return connection;
}
