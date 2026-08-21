import { CallServiceConfig, getCallService } from './services/call-service';
import { getCallServiceFactory } from './services/call-service-factory';
import { ConnectionServiceConfig, getConnectionService } from './services/connection-service';
import { Connection, translateConnection } from './services/connection/connection';
import { getDefaultWebRTC } from './services/connection/web-rtc';
import { getHandleService, HandleServiceConfig } from './services/handle-service';
import { getAnswerCallHandler } from './services/handle/answer-call-handler';
import { getCloseCallHandler } from './services/handle/close-call-handler';
import { getDialCallHandler } from './services/handle/dial-call-handler';
import { getIceCallHandler } from './services/handle/ice-call-handler';
import { getOfferCallHandler } from './services/handle/offer-call-handler';
import { LoggerServiceConfig } from './services/logger-service';
import { getPushService, PushServiceConfig } from './services/push-service';
import { getSessionService, SessionServiceConfig } from './services/session-service';
import { getSignalRService, SignalRServiceConfig } from './services/signalr-service';
import { getTimeService } from './services/time-service';
import { getWorkerService, WorkerServiceConfig } from './services/worker-service';
import { getApiClient } from './utils/api-client';
import { getBase64 } from './utils/base64';
import { CryptoKeyPair, getCryptography } from './utils/cryptography';
import { Logger } from './utils/logger';
import { getUtf8 } from './utils/utf8';
import { urlBase64ToUint8Array } from './utils/web-push-helpers';

/** Interval at which a client re-announces itself to a server, be it the prime one or a guest connection to a peer's server, so that its registration there never goes stale. */
const UPDATE_INTERVAL = 60 * 1000;

/** How long bringing a signalling connection up may take before the messenger stops waiting on it and carries on. */
const INITIALIZATION_TIMEOUT = 5 * 1000;

/** How long a signalling call waits for its connection to become ready before failing. This is the bound that turns a server refusing us into a reported failure instead of a call that hangs. */
const READY_TIMEOUT = 10 * 1000;

export type EphemonConfig = {
    onMayWorkUnstably?: (reason: string) => Promise<void>;
} & LoggerServiceConfig &
    SignalRServiceConfig &
    WorkerServiceConfig &
    PushServiceConfig &
    SessionServiceConfig &
    CallServiceConfig &
    ConnectionServiceConfig &
    HandleServiceConfig;

export interface Ephemon {
    get publicKey(): string | undefined;

    get serverTime(): number;

    /** If the clock has already been synchronized before the listener was registered, it is invoked immediately with the most recent timestamp, so freshness can be judged right away by comparing it against serverTime. */
    onServerSync(listener: (timestamp: number) => void): void;

    get connections(): Connection[];

    /** If a connection already exists, it is returned; otherwise, a new outgoing connection is created. */
    get(publicKeyBase64: string, serverUrl?: string): Connection;

    delete(publicKeyBase64: string): void;

    showNotification(title: string, options?: NotificationOptions): boolean;
}

export interface EphemonPrototype {
    initialize(config: EphemonConfig): Promise<Ephemon>;

    generateSigningKeyPair(): CryptoKeyPair;
}

export function getPrototype(logger: Logger): EphemonPrototype {
    const base64 = getBase64();
    const utf8 = getUtf8();
    const timeService = getTimeService(logger);
    const cryptography = getCryptography(logger);
    const apiClient = getApiClient(logger);
    const signalRService = getSignalRService(logger);
    const workerService = getWorkerService(logger);
    const sessionService = getSessionService(logger, base64);
    const pushService = getPushService(logger, workerService, base64);
    const callService = getCallService(
        logger,
        timeService,
        sessionService,
        apiClient,
        signalRService,
        base64,
        utf8,
        cryptography,
    );
    const callServiceFactory = getCallServiceFactory(logger, sessionService, apiClient, base64, utf8, cryptography);
    const connectionService = getConnectionService(
        logger,
        timeService,
        callServiceFactory,
        sessionService,
        base64,
        utf8,
        cryptography,
    );
    const dialCallHandler = getDialCallHandler(logger, sessionService, base64, utf8, cryptography, connectionService);
    const offerCallHandler = getOfferCallHandler(logger, sessionService, base64, utf8, cryptography, connectionService);
    const answerCallHandler = getAnswerCallHandler(
        logger,
        sessionService,
        base64,
        utf8,
        cryptography,
        connectionService,
    );
    const iceCallHandler = getIceCallHandler(logger, sessionService, base64, utf8, cryptography, connectionService);
    const closeCallHandler = getCloseCallHandler(logger, sessionService, base64, utf8, cryptography, connectionService);
    const handleService = getHandleService(
        logger,
        dialCallHandler,
        offerCallHandler,
        answerCallHandler,
        iceCallHandler,
        closeCallHandler,
    );
    let busy = false;
    let initializationResolver: ((value: Ephemon) => void) | undefined;
    let initializationPromise = new Promise<Ephemon>((resolve) => {
        initializationResolver = resolve;
    });
    const ephemon: Ephemon = {
        get publicKey(): string | undefined {
            return sessionService.signingPublicKeyBase64Safe;
        },
        get serverTime(): number {
            return timeService.serverTime;
        },
        onServerSync(listener: (timestamp: number) => void): void {
            timeService.onSync(listener);
        },
        get connections(): Connection[] {
            return connectionService.connections.map(translateConnection);
        },
        get(publicKeyBase64: string, serverUrl?: string): Connection {
            const connection = connectionService.getConnection(publicKeyBase64);
            if (!connection) {
                return translateConnection(connectionService.createOutgoing(publicKeyBase64, serverUrl));
            }
            if (serverUrl) {
                connection.setServerUrl(serverUrl);
            }
            return translateConnection(connection);
        },
        delete(publicKeyBase64: string) {
            connectionService.deleteConnection(publicKeyBase64);
        },
        showNotification(title: string, options?: NotificationOptions) {
            return pushService.showNotification(title, options);
        },
    };
    return {
        async initialize(config: EphemonConfig): Promise<Ephemon> {
            if (busy) {
                logger.warn('[ephemon] Parallel initialization attempt.');
                await initializationPromise;
                return ephemon;
            }
            busy = true;
            handleService.initialize(config);
            connectionService.initialize({
                ...config,
                webRTC: getDefaultWebRTC(),
            });
            callService.initialize({
                ...config,
                navigator: window.navigator,
                allowApiFallback: true,
            });
            callServiceFactory.initialize({
                serverUrl: config.serverUrl,
                navigator: window.navigator,
                prime: callService,
                onCall: handleService.call,
                initializationTimeout: INITIALIZATION_TIMEOUT,
                updateInterval: UPDATE_INTERVAL,
                readyTimeout: READY_TIMEOUT,
            });

            await workerService.initialize({
                ...config,
                navigator: window.navigator,
            });

            await sessionService.initialize(config);

            await pushService.initialize({
                ...config,
                onCall: (payload) => handleService.call(payload, timeService),
                notification: window.Notification,
                pushManager: window.PushManager,
                urlBase64ToUint8Array: urlBase64ToUint8Array,
            });

            const subscription = await pushService.getSubscription();

            async function update(): Promise<void> {
                const response = await callService.update(sessionService.signingPublicKeyBase64, subscription);
                if (response?.ok) {
                    const worker = workerService.registration?.active ?? workerService.controller;
                    worker?.postMessage({ type: 'CLIENT_READY' });
                }
            }

            await signalRService.initialize({
                ...config,
                onCall: (payload) => handleService.call(payload, timeService),
                onReady: update,
                initializationTimeout: INITIALIZATION_TIMEOUT,
                readyTimeout: READY_TIMEOUT,
            });

            setInterval(update, UPDATE_INTERVAL);

            if (!subscription) {
                if (config.onMayWorkUnstably) {
                    await config.onMayWorkUnstably(
                        'Due to notifications unavailable, this messenger may work unstably.',
                    );
                }
            }

            logger.log('[ephemon] Initialized.');
            initializationResolver?.call(this, ephemon);
            busy = false;
            return ephemon;
        },
        generateSigningKeyPair(): CryptoKeyPair {
            return cryptography.generateSigningKeyPair();
        },
    };
}
