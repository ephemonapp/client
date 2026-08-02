import { AnswerCallData } from '../models/answer-call-data';
import { CloseCallData } from '../models/close-call-data';
import { DialCallData } from '../models/dial-call-data';
import { IceCallData } from '../models/ice-call-data';
import { IceSource } from '../models/ice-source';
import { CallData } from '../models/infrasctructure/call-data';
import { CallMethodName } from '../models/infrasctructure/call-method-name';
import { CallRequest } from '../models/infrasctructure/call-request';
import { CallResponse } from '../models/infrasctructure/call-response';
import { OfferCallData } from '../models/offer-call-data';
import { UpdateCallData } from '../models/update-call-data';
import { ApiClient } from '../utils/api-client';
import { Base64 } from '../utils/base64';
import { Cryptography } from '../utils/cryptography';
import { Logger } from '../utils/logger';
import { newError } from '../utils/new-error';
import { Utf8 } from '../utils/utf8';
import { Subscription } from './push-service';
import { SessionService } from './session-service';
import { SignalRService } from './signalr-service';
import { TimeService } from './time-service';

export type CallServiceConfig = {
    serverUrl?: string;
};

type CallServiceEffectiveConfig = CallServiceConfig & {
    navigator: Navigator;

    /** Whether calls may be retried over the http API when SignalR is unavailable. Guest connections to a foreign server rely on the SignalR connection to be reachable, so for them the http API is not an equivalent transport and the fallback is disabled. */
    allowApiFallback: boolean;
};

export interface CallService {
    initialize(config: CallServiceEffectiveConfig): void;

    update(publicKey: string, subscription?: Subscription): Promise<CallResponse>;

    dial(publicKey: string, peerPublicKey: string, encryptionPublicKey: string): Promise<CallResponse>;

    offer(
        publicKey: string,
        peerPublicKey: string,
        encryptionPublicKey: string,
        encryptedData: Uint8Array,
    ): Promise<CallResponse>;

    answer(
        publicKey: string,
        peerPublicKey: string,
        encryptionPublicKey: string,
        encryptedData: Uint8Array,
    ): Promise<CallResponse>;

    ice(
        publicKey: string,
        peerPublicKey: string,
        encryptionPublicKey: string,
        encryptedData: Uint8Array,
        source: IceSource,
    ): Promise<CallResponse>;

    close(publicKey: string, peerPublicKey: string): void;
}

export function getCallService(
    logger: Logger,
    timeService: TimeService,
    sessionService: SessionService,
    apiClient: ApiClient,
    signalRService: SignalRService,
    base64: Base64,
    utf8: Utf8,
    cryptography: Cryptography,
): CallService {
    let serverUrl: string | undefined;
    let navigator: Navigator;
    let allowApiFallback = true;

    function getBase64Signature(data: any): string {
        const dataString = JSON.stringify(data);
        const dataBytes = utf8.decode(dataString);
        const signatureSecretKey = sessionService.signingKeyPair.secretKey;
        const dataSignature = cryptography.sign(dataBytes, signatureSecretKey);
        return base64.encode(dataSignature);
    }

    async function signAndSend<TypeData extends CallData>(
        method: CallMethodName,
        data: TypeData,
    ): Promise<CallResponse> {
        const request: CallRequest<TypeData> = {
            a: method,
            b: data,
            c: getBase64Signature(data),
        };
        let response: CallResponse | undefined;
        let trySignalR = signalRService.ready || !allowApiFallback;
        let tryApi = false;

        if (trySignalR) {
            try {
                response = await signalRService.call(request);
            } catch (error) {
                if (allowApiFallback) {
                    tryApi = true;
                    logger.warn(
                        `[call-service] Error while sending call '${request.a}' via signalR. Trying to use http API.`,
                        error,
                    );
                } else {
                    logger.error(`[call-service] Error while sending call '${request.a}' via signalR.`, error);
                }
            }
        } else {
            tryApi = true;
            logger.warn(`[call-service] SignalR is not ready. Trying to use http API.`);
        }

        if (tryApi) {
            if (!serverUrl) {
                throw newError(logger, '[call-service] Server URL is missing.');
            }
            try {
                response = await apiClient.call(serverUrl, request);
            } catch (error) {
                logger.error(`[call-service] Error while sending call '${request.a}' via http API.`, error);
            }
        }

        if (!response) {
            throw newError(logger, `[call-service] Failed to send call '${request.a}'.`);
        }

        timeService.serverTime = response.timestamp;
        return response;
    }

    return {
        initialize(config: CallServiceEffectiveConfig): void {
            serverUrl = config.serverUrl;
            navigator = config.navigator;
            allowApiFallback = config.allowApiFallback;
            logger.debug(`[call-service] Initialized for ${serverUrl}.`);
        },
        async update(publicKey: string, subscription?: Subscription): Promise<CallResponse> {
            const data: UpdateCallData = {
                a: publicKey,
                b: !!subscription
                    ? {
                          a: subscription.endpoint,
                          b: subscription.expirationTime,
                          c: {
                              a: subscription.keys.p256dh,
                              b: subscription.keys.auth,
                          },
                      }
                    : undefined,
            };
            return await signAndSend<UpdateCallData>('update', data);
        },
        async dial(publicKey: string, peerPublicKey: string, encryptionPublicKeyBase64: string): Promise<CallResponse> {
            const data: DialCallData = {
                a: publicKey,
                b: timeService.serverTime,
                c: peerPublicKey,
                d: encryptionPublicKeyBase64,
            };
            return await signAndSend<DialCallData>('dial', data);
        },
        async offer(
            publicKey: string,
            peerPublicKey: string,
            encryptionPublicKeyBase64: string,
            encryptedData: Uint8Array,
        ): Promise<CallResponse> {
            const encryptedDataBase64 = base64.encode(encryptedData);
            const data: OfferCallData = {
                a: publicKey,
                b: timeService.serverTime,
                c: peerPublicKey,
                d: encryptionPublicKeyBase64,
                e: encryptedDataBase64,
            };
            return await signAndSend<OfferCallData>('offer', data);
        },
        async answer(
            publicKey: string,
            peerPublicKey: string,
            encryptionPublicKeyBase64: string,
            encryptedData: Uint8Array,
        ): Promise<CallResponse> {
            const encryptedDataBase64 = base64.encode(encryptedData);
            const data: AnswerCallData = {
                a: publicKey,
                b: timeService.serverTime,
                c: peerPublicKey,
                d: encryptionPublicKeyBase64,
                e: encryptedDataBase64,
            };
            return await signAndSend<AnswerCallData>('answer', data);
        },
        async ice(
            publicKey: string,
            peerPublicKey: string,
            encryptionPublicKeyBase64: string,
            encryptedData: Uint8Array,
            source: IceSource,
        ): Promise<CallResponse> {
            const encryptedDataBase64 = base64.encode(encryptedData);
            const data: IceCallData = {
                a: publicKey,
                b: timeService.serverTime,
                c: peerPublicKey,
                d: encryptionPublicKeyBase64,
                e: encryptedDataBase64,
                f: source,
            };
            return await signAndSend<IceCallData>('ice', data);
        },
        close(publicKey: string, peerPublicKey: string): void {
            const data: CloseCallData = {
                a: publicKey,
                b: timeService.serverTime,
                c: peerPublicKey,
            };
            const request: CallRequest<CloseCallData> = {
                a: 'close',
                b: data,
                c: getBase64Signature(data),
            };
            const headers = {
                type: 'application/json',
            };
            const blob = new Blob([JSON.stringify(request)], headers);
            navigator.sendBeacon(`${serverUrl}/api/v1/call`, blob);
        },
    };
}
