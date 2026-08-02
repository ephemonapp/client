import { CloseCallData } from '../../models/close-call-data';
import { CallRequest } from '../../models/infrasctructure/call-request';
import { Base64 } from '../../utils/base64';
import { Cryptography } from '../../utils/cryptography';
import { Logger } from '../../utils/logger';
import { Utf8 } from '../../utils/utf8';
import { ConnectionService } from '../connection-service';
import { SessionService } from '../session-service';
import { CallHandler, getCallHandler } from './call-handler';

export interface CloseCallHandler extends CallHandler<CloseCallData> {}

export function getCloseCallHandler(
    logger: Logger,
    sessionService: SessionService,
    base64: Base64,
    utf8: Utf8,
    cryptography: Cryptography,
    connectionService: ConnectionService,
): CloseCallHandler {
    const handler = getCallHandler<CloseCallData>(logger, sessionService, base64, utf8, cryptography, 0);
    return {
        ...handler,
        handle(request: CallRequest<CloseCallData>): Promise<boolean> {
            const peerPublicKey = request.b.a;
            const connection = connectionService.getConnection(peerPublicKey);
            if (!connection) {
                logger.debug(
                    `[close-call-handler] Incoming call '${request.a}' from ${peerPublicKey} ignored. No one connection is there.`,
                );
                return Promise.resolve(true);
            }
            const connectionOpenedAt = connection.openedAt;
            if (connectionOpenedAt !== undefined && connectionOpenedAt !== null && connectionOpenedAt >= request.b.b) {
                logger.debug(
                    `[close-call-handler] Incoming call '${request.a}' from ${peerPublicKey} ignored. Timestamp is too late.`,
                );
                return Promise.resolve(true);
            }
            connection.closeByPeer();
            return Promise.resolve(true);
        },
    };
}
