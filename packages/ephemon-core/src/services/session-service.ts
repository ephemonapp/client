import { Base64 } from '../utils/base64';
import { CryptoKeyPair } from '../utils/cryptography';
import { Logger } from '../utils/logger';
import { newError } from '../utils/new-error';

export type SessionServiceConfig = {
    signingKeyPair?: CryptoKeyPair;
};

export interface SessionService {
    initialize(config: SessionServiceConfig): Promise<void>;

    get signingKeyPair(): CryptoKeyPair;

    get signingPublicKeyBase64(): string;

    /** Gets the Base64-encoded public signing key, if available. Returns undefined instead of throwing an error if the key is not initialized. */
    get signingPublicKeyBase64Safe(): string | undefined;
}

export function getSessionService(logger: Logger, base64: Base64): SessionService {
    let signingKeyPair: CryptoKeyPair | undefined;
    return {
        async initialize(config: SessionServiceConfig): Promise<void> {
            if (config.signingKeyPair === undefined || config.signingKeyPair === null) {
                throw newError(logger, '[session-service] Failed to initialize. Incomplete signing key pair.');
            } else {
                signingKeyPair = config.signingKeyPair;
                logger.debug('[session-service] Signing key pair found.');
            }
        },
        get signingKeyPair(): CryptoKeyPair {
            if (!signingKeyPair) {
                throw newError(logger, '[session-service] Sign key pair has not initialized yet.');
            }
            return signingKeyPair;
        },
        get signingPublicKeyBase64(): string {
            if (!signingKeyPair) {
                throw newError(logger, '[session-service] Sign key pair has not initialized yet.');
            }

            return base64.encode(signingKeyPair.publicKey);
        },
        get signingPublicKeyBase64Safe(): string | undefined {
            return signingKeyPair && base64.encode(signingKeyPair.publicKey);
        },
    };
}
