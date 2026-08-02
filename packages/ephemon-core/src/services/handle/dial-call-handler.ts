import { DialCallData } from '../../models/dial-call-data';
import { CallRequest } from '../../models/infrasctructure/call-request';
import { Base64 } from '../../utils/base64';
import { Cryptography } from '../../utils/cryptography';
import { Logger } from '../../utils/logger';
import { Utf8 } from '../../utils/utf8';
import { ConnectionService } from '../connection-service';
import { ConnectionSagaState } from '../connection/connection-saga';
import { SessionService } from '../session-service';
import { CallHandler, getCallHandler } from './call-handler';

export type DialCallHandlerConfig = {
    focusOnDial?: (publicKey: string) => Promise<boolean>;

    requestDial?: (publicKey: string) => Promise<boolean>;
};

export interface DialCallHandler extends CallHandler<DialCallData> {
    initialize(config: DialCallHandlerConfig): void;
}

export function getDialCallHandler(
    logger: Logger,
    sessionService: SessionService,
    base64: Base64,
    utf8: Utf8,
    cryptography: Cryptography,
    connectionService: ConnectionService,
): DialCallHandler {
    const handler = getCallHandler<DialCallData>(logger, sessionService, base64, utf8, cryptography, 0);
    let focusOnDial: ((publicKey: string) => Promise<boolean>) | undefined;
    let requestDial: ((publicKey: string) => Promise<boolean>) | undefined;
    return {
        initialize(config: DialCallHandlerConfig) {
            focusOnDial = config.focusOnDial;
            requestDial = config.requestDial;
            logger.debug('[dial-call-handler] Initialized.');
        },
        ...handler,
        async handle(request: CallRequest<DialCallData>): Promise<boolean> {
            const peerPublicKey = request.b.a;
            let connection = connectionService.getConnection(peerPublicKey);
            if (connection) {
                connection.setIncomingEncryption(request.b.d);
                if (connection.incomingState === ConnectionSagaState.AwaitingDial) {
                    connection.continueIncoming();
                    return true;
                }
                if (connection.incomingState !== ConnectionSagaState.AwaitingAnswer) {
                    logger.debug(
                        `[dial-call-handler] Incoming call '${request.a}' from ${peerPublicKey} triggered connection re-open. Incoming saga is not in suitable state (${ConnectionSagaState[ConnectionSagaState.AwaitingDial]} expected, ${ConnectionSagaState[connection.incomingState]} found).`,
                    );
                    new Promise(async () => {
                        if (focusOnDial !== undefined && focusOnDial !== null) {
                            await focusOnDial(request.b.a);
                        }
                    });
                    await connection.openIncoming();
                }
            } else {
                if (focusOnDial !== undefined && focusOnDial !== null && !(await focusOnDial(request.b.a))) {
                    return false;
                }
                if (requestDial !== undefined && requestDial !== null && !(await requestDial(request.b.a))) {
                    logger.debug(`[dial-call-handler] Incoming call '${request.a}' from ${peerPublicKey} declined.`);
                    return true;
                }
                connection = connectionService.createIncoming(peerPublicKey);
                connection.setIncomingEncryption(request.b.d);
                await connection.openIncoming();
            }
            return true;
        },
    };
}
