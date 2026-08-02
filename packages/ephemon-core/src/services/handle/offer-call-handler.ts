import { CallRequest } from '../../models/infrasctructure/call-request';
import { OfferCallData } from '../../models/offer-call-data';
import { Base64 } from '../../utils/base64';
import { Cryptography } from '../../utils/cryptography';
import { Logger } from '../../utils/logger';
import { Utf8 } from '../../utils/utf8';
import { ConnectionService } from '../connection-service';
import { ConnectionSagaState } from '../connection/connection-saga';
import { SessionService } from '../session-service';
import { CallHandler, getCallHandler } from './call-handler';

export interface OfferCallHandler extends CallHandler<OfferCallData> {}

export function getOfferCallHandler(
    logger: Logger,
    sessionService: SessionService,
    base64: Base64,
    utf8: Utf8,
    cryptography: Cryptography,
    connectionService: ConnectionService,
): OfferCallHandler {
    const handler = getCallHandler<OfferCallData>(logger, sessionService, base64, utf8, cryptography);
    return {
        ...handler,
        async handle(request: CallRequest<OfferCallData>): Promise<boolean> {
            const peerPublicKey = request.b.a;
            const connection = connectionService.getConnection(peerPublicKey);
            if (!connection) {
                logger.debug(
                    `[offer-call-handler] Incoming call '${request.a}' from ${peerPublicKey} ignored. No one connection is there.`,
                );
                return true;
            }
            if (connection.outgoingState !== ConnectionSagaState.AwaitingOffer) {
                logger.debug(
                    `[offer-call-handler] Incoming call '${request.a}' from ${peerPublicKey} ignored. Outgoing saga is not in suitable state (${ConnectionSagaState[ConnectionSagaState.AwaitingOffer]} expected, ${ConnectionSagaState[connection.outgoingState]} found).`,
                );
                return true;
            }
            connection.setOutgoingEncryption(request.b.d);
            await connection.setOutgoingDescription(request.b.e);
            connection.continueOutgoing();
            return true;
        },
    };
}
