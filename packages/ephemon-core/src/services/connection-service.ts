import { Base64 } from '../utils/base64';
import { Cryptography } from '../utils/cryptography';
import { Logger } from '../utils/logger';
import { Utf8 } from '../utils/utf8';
import { CallServiceFactory } from './call-service-factory';
import {
    Connection,
    ConnectionInternal,
    ConnectionState,
    getConnection,
    translateConnection,
} from './connection/connection';
import { IceServer } from './connection/ice-server';
import { WebRTC } from './connection/web-rtc';
import { SessionService } from './session-service';
import { TimeService } from './time-service';

export type ConnectionServiceConfig = {
    onIncomingConnection?: (connection: Connection) => void;

    iceServers?: IceServer[];
};

type ConnectionServiceEffectiveConfig = ConnectionServiceConfig & {
    webRTC: WebRTC;
};

export interface ConnectionService {
    initialize(config: ConnectionServiceEffectiveConfig): void;

    get connections(): ConnectionInternal[];

    getConnection(publicKey: string): ConnectionInternal | undefined;

    createIncoming(peerSigningPublicKey: string): ConnectionInternal;

    createOutgoing(peerSigningPublicKey: string, serverUrl?: string): ConnectionInternal;

    deleteConnection(publicKey: string): void;
}

export function getConnectionService(
    logger: Logger,
    timeService: TimeService,
    callServiceFactory: CallServiceFactory,
    sessionService: SessionService,
    base64: Base64,
    utf8: Utf8,
    cryptography: Cryptography,
): ConnectionService {
    let onIncomingConnection: ((connection: Connection) => void) | undefined;
    let iceServers: IceServer[] | undefined;
    let webRTC: WebRTC;
    let connections: {
        [publicKey: string]: ConnectionInternal;
    } = {};

    function createConnection(publicKey: string, serverUrl?: string): ConnectionInternal {
        const connection = getConnection(
            publicKey,
            logger,
            timeService,
            callServiceFactory,
            sessionService,
            base64,
            utf8,
            cryptography,
            webRTC,
            iceServers,
            serverUrl,
        );
        connections[publicKey] = connection;
        return connection;
    }

    return {
        initialize(config: ConnectionServiceEffectiveConfig): void {
            onIncomingConnection = config.onIncomingConnection;
            iceServers = config.iceServers;
            webRTC = config.webRTC;
            logger.debug('[connection-service] Initialized.');
        },
        get connections(): ConnectionInternal[] {
            return Object.values(connections);
        },
        getConnection(publicKey: string): ConnectionInternal | undefined {
            return connections[publicKey];
        },
        createIncoming(publicKey: string): ConnectionInternal {
            const connection = createConnection(publicKey);
            new Promise<void>((resolve) => {
                if (onIncomingConnection) {
                    onIncomingConnection(translateConnection(connection));
                }
                resolve();
            }).catch((err) => {
                logger.error('[connection-service] On incoming connection callback error.', err);
            });
            return connection;
        },
        createOutgoing(publicKey: string, serverUrl?: string): ConnectionInternal {
            return createConnection(publicKey, serverUrl);
        },
        deleteConnection(publicKey: string) {
            if (
                connections[publicKey]?.state !== undefined &&
                connections[publicKey]?.state !== null &&
                connections[publicKey].state !== ConnectionState.Closed
            ) {
                connections[publicKey].close();
            }
            delete connections[publicKey];
        },
    };
}
