import { CallData } from '../models/infrasctructure/call-data';
import { CallPayload } from '../models/infrasctructure/call-payload';
import { CallRequest } from '../models/infrasctructure/call-request';
import { CallResponse } from '../models/infrasctructure/call-response';
import { newCallError } from '../utils/call-error';
import { Logger } from '../utils/logger';
import { HubConnection, HubConnectionBuilder, LogLevel, RetryContext } from '@microsoft/signalr';

export type SignalRServiceConfig = {
    serverUrl?: string;
};

type SignalRServiceEffectiveConfig = {
    onCall: (payload: CallPayload) => Promise<void>;

    onReady: () => Promise<void>;

    initializationTimeout: number;

    /** Without this bound a server that refuses us — a CORS rejection, an unreachable host — would leave every call pending forever, and the connection attempt behind it hanging with nothing to report. */
    readyTimeout: number;
} & SignalRServiceConfig;

export interface SignalRService {
    initialize(config: SignalRServiceEffectiveConfig): Promise<void>;

    get ready(): boolean;

    /** Used to let go of a server that turned out to be unreachable instead of retrying against it for the rest of the session. */
    stop(): Promise<void>;

    call<TypeData extends CallData>(request: CallRequest<TypeData>): Promise<CallResponse>;
}

export function getSignalRService(logger: Logger): SignalRService {
    let connection: HubConnection | undefined;
    let readyResolver: (() => void) | undefined;
    let readyPromise: Promise<void> | undefined;
    function resetReadyPromise(): void {
        if (!readyPromise) {
            readyPromise = new Promise<void>((resolve) => {
                readyResolver = () => {
                    resolve();
                    readyPromise = undefined;
                };
            });
        }
    }
    /** Waits for the connection to become ready, but only for as long as the configured bound. A server that never lets us in has to surface as a failed call rather than as a call that never settles. */
    async function awaitReady(): Promise<void> {
        const pending = readyPromise;
        if (!pending) {
            return;
        }
        let timeout: NodeJS.Timeout | undefined;
        const expired = await Promise.race([
            pending.then(() => false),
            new Promise<boolean>((resolve) => {
                timeout = setTimeout(() => resolve(true), readyTimeout);
            }),
        ]);
        clearTimeout(timeout);
        if (expired) {
            throw newCallError(
                logger,
                `[signalr-service] Connection to ${serverUrl} did not become ready within ${readyTimeout}ms.`,
                serverUrl,
            );
        }
    }

    let serverUrl: string | undefined;
    let readyTimeout = 0;
    let retryTimeout: NodeJS.Timeout | undefined;
    let stopped = false;
    return {
        async initialize(config: SignalRServiceEffectiveConfig): Promise<void> {
            resetReadyPromise();
            serverUrl = config.serverUrl;
            readyTimeout = config.readyTimeout;
            stopped = false;
            connection = new HubConnectionBuilder()
                .withUrl(`${config.serverUrl}/signal/v1`)
                .withAutomaticReconnect({
                    nextRetryDelayInMilliseconds(retryContext: RetryContext): number | null {
                        return Math.max(1000 + 1000 * retryContext.previousRetryCount, 5000);
                    },
                })
                .configureLogging(LogLevel.None)
                .build();
            connection.onreconnecting(() => {
                resetReadyPromise();
                logger.warn('[signalr-service] Reconnecting ...');
            });
            connection.onreconnected(async () => {
                readyResolver?.call(this);
                logger.warn('[signalr-service] Reconnected.');
                await config.onReady();
            });
            connection.on('call', async (payload: CallPayload) => {
                logger.debug('[signalr-service] Message received.', payload);
                if (!config.onCall) {
                    logger.warn('[signalr-service] Signalling message callback is not initialized.');
                    return;
                }
                if (!payload || !payload.a) {
                    logger.error('[signalr-service] Invalid payload data.');
                    return;
                }
                try {
                    await config.onCall(payload);
                } catch (error: any) {
                    logger.error(`[signalr-service] Error while processing signalR call.`, error.message);
                }
            });
            async function startConnection(
                connection: HubConnection,
                signalRService: SignalRService,
                retryCount: number,
            ): Promise<void> {
                try {
                    await connection.start();
                    readyResolver?.call(signalRService);
                    logger.debug('[signalr-service] SignalR is ready.');
                    await config.onReady();
                } catch (error: any) {
                    logger.error('[signalr-service] SignalR connection error.', error.message);
                    resetReadyPromise();
                    if (stopped) {
                        return;
                    }
                    const retryDelay = Math.min(1000 + 1000 * retryCount, 5000);
                    retryTimeout = setTimeout(
                        () => startConnection(connection, signalRService, retryCount + 1),
                        retryDelay,
                    );
                }
            }
            startConnection(connection, this, 0);
            await Promise.race([
                new Promise((resolve) => setTimeout(resolve, config.initializationTimeout)),
                readyPromise,
            ]);
        },
        get ready(): boolean {
            return !readyPromise;
        },
        async stop(): Promise<void> {
            stopped = true;
            clearTimeout(retryTimeout);
            retryTimeout = undefined;
            try {
                await connection?.stop();
            } catch (error) {
                logger.warn(`[signalr-service] Error while stopping the connection to ${serverUrl}.`, error);
            }
            logger.debug(`[signalr-service] Connection to ${serverUrl} stopped.`);
        },
        async call<TypeData extends CallData, TypeResponse extends CallResponse>(
            request: CallRequest<TypeData>,
        ): Promise<TypeResponse> {
            await awaitReady();
            if (!connection) {
                throw newCallError(logger, '[signalr-service] SignalR connection is not initialized.', serverUrl);
            }
            const method = request.a;
            try {
                const response = await connection.invoke<TypeResponse>('call', request);
                if (!response) {
                    throw newCallError(
                        logger,
                        `[signalr-service] Unexpected answer on call ${method} from ${serverUrl}.`,
                        serverUrl,
                    );
                }
                if (!response.ok) {
                    throw newCallError(
                        logger,
                        `[signalr-service] Request was not successful on call '${method}'. Reason: ${response.reason}; Response: ${JSON.stringify(response)}.`,
                        serverUrl,
                        response.reason,
                    );
                }
                logger.debug(
                    `[signalr-service] Call '${method}' successfully sent. Response: ${JSON.stringify(response)}`,
                );
                return response;
            } catch (error) {
                logger.error(`[signalr-service] Error while sending request.`, error, request);
                throw error;
            }
        },
    };
}
