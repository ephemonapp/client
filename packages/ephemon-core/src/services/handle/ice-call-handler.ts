import { IceCallData } from '../../models/ice-call-data';
import { IceSource } from '../../models/ice-source';
import { CallRequest } from '../../models/infrasctructure/call-request';
import { Base64 } from '../../utils/base64';
import { Cryptography } from '../../utils/cryptography';
import { Logger } from '../../utils/logger';
import { Utf8 } from '../../utils/utf8';
import { ConnectionService } from '../connection-service';
import { SessionService } from '../session-service';
import { CallHandler, getCallHandler } from './call-handler';

export interface IceCallHandler extends CallHandler<IceCallData> {}

export function getIceCallHandler(
    logger: Logger,
    sessionService: SessionService,
    base64: Base64,
    utf8: Utf8,
    cryptography: Cryptography,
    connectionService: ConnectionService,
): IceCallHandler {
    const handler = getCallHandler<IceCallData>(logger, sessionService, base64, utf8, cryptography);
    return {
        ...handler,
        async handle(request: CallRequest<IceCallData>): Promise<boolean> {
            const peerPublicKey = request.b.a;
            const connection = connectionService.getConnection(peerPublicKey);
            if (!connection) {
                logger.debug(
                    `[ice-call-handler] Incoming call '${request.a}' from ${peerPublicKey} ignored. No one connection is there.`,
                );
                return true;
            }
            switch (request.b.f) {
                case IceSource.Incoming:
                    connection.setOutgoingEncryption(request.b.d);
                    await connection.addOutgoingIce(request.b.e);
                    break;
                case IceSource.Outgoing:
                    connection.setIncomingEncryption(request.b.d);
                    await connection.addIncomingIce(request.b.e);
                    break;
                default:
                    logger.debug(`[ice-call-handler] Unknown ice source from ${peerPublicKey} ignored.`);
                    break;
            }
            return true;
        },
    };
}
