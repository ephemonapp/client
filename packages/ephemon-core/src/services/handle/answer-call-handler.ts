import { AnswerCallData } from '../../models/answer-call-data';
import { CallRequest } from '../../models/infrasctructure/call-request';
import { Base64 } from '../../utils/base64';
import { Cryptography } from '../../utils/cryptography';
import { Logger } from '../../utils/logger';
import { Utf8 } from '../../utils/utf8';
import { ConnectionService } from '../connection-service';
import { ConnectionSagaState } from '../connection/connection-saga';
import { SessionService } from '../session-service';
import { CallHandler, getCallHandler } from './call-handler';

export interface AnswerCallHandler extends CallHandler<AnswerCallData> {}

export function getAnswerCallHandler(
    logger: Logger,
    sessionService: SessionService,
    base64: Base64,
    utf8: Utf8,
    cryptography: Cryptography,
    connectionService: ConnectionService,
): AnswerCallHandler {
    const handler = getCallHandler<AnswerCallData>(logger, sessionService, base64, utf8, cryptography);
    return {
        ...handler,
        async handle(request: CallRequest<AnswerCallData>): Promise<boolean> {
            const peerPublicKey = request.b.a;
            const connection = connectionService.getConnection(peerPublicKey);
            if (!connection) {
                logger.debug(
                    `[answer-call-handler] Incoming call '${request.a}' from ${peerPublicKey} ignored. No one connection is there.`,
                );
                return true;
            }
            if (connection.incomingState !== ConnectionSagaState.AwaitingAnswer) {
                logger.debug(
                    `[answer-call-handler] Incoming call '${request.a}' from ${peerPublicKey} ignored. Incoming saga is not in suitable state (${ConnectionSagaState[ConnectionSagaState.AwaitingAnswer]} expected, ${ConnectionSagaState[connection.incomingState]} found).`,
                );
                return true;
            }
            connection.setIncomingEncryption(request.b.d);
            await connection.setIncomingDescription(request.b.e);
            connection.continueIncoming();
            return true;
        },
    };
}
