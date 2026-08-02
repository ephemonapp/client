import { CallPayload } from '../models/infrasctructure/call-payload';
import { ApiClient } from '../utils/api-client';
import { Base64 } from '../utils/base64';
import { newCallError } from '../utils/call-error';
import { Cryptography } from '../utils/cryptography';
import { Logger } from '../utils/logger';
import { newError } from '../utils/new-error';
import { Utf8 } from '../utils/utf8';
import { CallService, getCallService } from './call-service';
import { SessionService } from './session-service';
import { getSignalRService } from './signalr-service';
import { getTimeService, TimeService } from './time-service';

type CallServiceFactoryEffectiveConfig = {
    serverUrl?: string;

    navigator: Navigator;

    prime: CallService;

    onCall: (payload: CallPayload, timeService: TimeService) => Promise<void>;

    initializationTimeout: number;

    updateInterval: number;

    /** How long a call through a guest waits for its connection to become ready before failing. */
    readyTimeout: number;
};

/** A peer is only reachable through the server it is registered on, so talking to a peer whose server differs from ours requires a second, "guest" connection to that server: a SignalR channel that is opened once and kept alive for as long as the application runs. */
export interface CallServiceFactory {
    initialize(config: CallServiceFactoryEffectiveConfig): void;

    get prime(): CallService;

    get primeServerUrl(): string | undefined;

    getForServerUrl(serverUrl?: string): Promise<CallService>;
}

function normalizeServerUrl(serverUrl: string): string {
    return serverUrl.trim().replace(/\/+$/, '');
}

export function getCallServiceFactory(
    logger: Logger,
    sessionService: SessionService,
    apiClient: ApiClient,
    base64: Base64,
    utf8: Utf8,
    cryptography: Cryptography,
): CallServiceFactory {
    let config: CallServiceFactoryEffectiveConfig | undefined;
    const guests: {
        [serverUrl: string]: Promise<CallService>;
    } = {};

    function getConfig(): CallServiceFactoryEffectiveConfig {
        if (!config) {
            throw newError(logger, '[call-service-factory] Factory has not been initialized yet.');
        }
        return config;
    }

    async function createGuest(serverUrl: string): Promise<CallService> {
        const { navigator, onCall, initializationTimeout, updateInterval, readyTimeout } = getConfig();
        const signalRService = getSignalRService(logger);
        const timeService = getTimeService(logger);
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
        callService.initialize({ serverUrl: serverUrl, navigator: navigator, allowApiFallback: false });
        async function update(): Promise<void> {
            await callService.update(sessionService.signingPublicKeyBase64);
        }
        await signalRService.initialize({
            serverUrl: serverUrl,
            onCall: (payload) => onCall(payload, timeService),
            onReady: update,
            initializationTimeout: initializationTimeout,
            readyTimeout: readyTimeout,
        });
        if (!signalRService.ready) {
            await signalRService.stop();
            throw newCallError(logger, `[call-service-factory] Server ${serverUrl} is not reachable.`, serverUrl);
        }
        setInterval(
            () =>
                update().catch((error) =>
                    logger.error(`[call-service-factory] Error while updating the guest of ${serverUrl}.`, error),
                ),
            updateInterval,
        );
        logger.log(`[call-service-factory] Guest connection to ${serverUrl} is up.`);
        return callService;
    }

    return {
        initialize(value: CallServiceFactoryEffectiveConfig): void {
            config = value;
            logger.debug('[call-service-factory] Initialized.');
        },
        get prime(): CallService {
            return getConfig().prime;
        },
        get primeServerUrl(): string | undefined {
            const { serverUrl } = getConfig();
            return serverUrl ? normalizeServerUrl(serverUrl) : undefined;
        },
        getForServerUrl(serverUrl?: string): Promise<CallService> {
            const { prime, serverUrl: primeServerUrl } = getConfig();
            const target = serverUrl ? normalizeServerUrl(serverUrl) : undefined;
            if (!target || (primeServerUrl && target === normalizeServerUrl(primeServerUrl))) {
                return Promise.resolve(prime);
            }
            if (!guests[target]) {
                guests[target] = createGuest(target).catch((error) => {
                    delete guests[target];
                    throw error;
                });
            }
            return guests[target];
        },
    };
}
