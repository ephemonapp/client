import { CloseCallData } from '../../models/close-call-data';
import { CallData } from '../../models/infrasctructure/call-data';
import { CallPayload } from '../../models/infrasctructure/call-payload';
import { CallRequest } from '../../models/infrasctructure/call-request';
import { Base64 } from '../../utils/base64';
import { Cryptography } from '../../utils/cryptography';
import { Logger } from '../../utils/logger';
import { newError } from '../../utils/new-error';
import { Utf8 } from '../../utils/utf8';
import { SessionService } from '../session-service';
import { TimeService } from '../time-service';

export interface CallHandler<TypeData extends CallData> {
    parse(payloadData: CallPayload): CallRequest<TypeData>;

    validate(request: CallRequest<TypeData>, timeService: TimeService): boolean;

    handle(request: CallRequest<TypeData>): Promise<boolean>;
}

export function getCallHandler<TypeData extends CloseCallData>(
    logger: Logger,
    sessionService: SessionService,
    base64: Base64,
    utf8: Utf8,
    cryptography: Cryptography,
    timestampMaxStale: number = 5 * 1000,
): CallHandler<TypeData> {
    function validateTimestamp(request: CallRequest<TypeData>, timeService: TimeService): boolean {
        if (timestampMaxStale === 0) {
            return true;
        }
        const delta = request.b.b - timeService.serverTime;
        if (Math.abs(delta) > timestampMaxStale) {
            logger.debug(
                `[${request.a}-call-handler] Request timestamp is more than ${timestampMaxStale}ms stale (delta ${delta}ms).`,
            );
            return false;
        }
        logger.debug(`[${request.a}-call-handler] Request timestamp is valid (delta ${delta}ms).`);
        return true;
    }

    function validatePublicKey(request: CallRequest<TypeData>): boolean {
        const isIntendedForMe = sessionService.signingPublicKeyBase64 === request.b.c;
        if (!isIntendedForMe) {
            logger.debug(`[${request.a}-call-handler] Message is not intended for this user.`);
            return false;
        }
        logger.debug(`[${request.a}-call-handler] Message is intended for this user.`);
        return true;
    }

    function validateSignature(request: CallRequest<TypeData>): boolean {
        const message = JSON.stringify(request.b);
        const messageBytes = utf8.decode(message);
        const signature = base64.decode(request.c);
        const singingPublicKeyBase64 = request.b.a;
        const signingPublicKey = base64.decode(singingPublicKeyBase64);
        const isSignatureVerified = cryptography.verifySignature(messageBytes, signature, signingPublicKey);
        if (!isSignatureVerified) {
            logger.debug(`[${request.a}-call-handler] Signature is not valid.`);
            return false;
        }
        logger.debug(`[${request.a}-call-handler] Signature is valid.`);
        return true;
    }

    return {
        parse(payloadData: CallPayload): CallRequest<TypeData> {
            const data = JSON.parse(payloadData.b) as TypeData;
            if (!data) {
                throw newError(
                    logger,
                    `[${payloadData.a}-call-handler] Unable to parse call data for call '${payloadData.a}'. Data: ${payloadData.b}`,
                );
            }
            return {
                a: payloadData.a,
                b: data,
                c: payloadData.c,
            };
        },
        validate(request: CallRequest<TypeData>, timeService: TimeService): boolean {
            if (!validateTimestamp(request, timeService)) {
                return false;
            }
            if (!validatePublicKey(request)) {
                return false;
            }
            return validateSignature(request);
        },
        handle(request: CallRequest<TypeData>): Promise<boolean> {
            throw newError(logger, `[${request.a}-call-handler] Base handle method is not implemented.`);
        },
    };
}
