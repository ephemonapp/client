import { createMockBase64, createMockKeyPair, createMockLogger } from '../../__mocks__/test-utils';
import { getSessionService, SessionServiceConfig } from '../../src/services/session-service';
import { Base64 } from '../../src/utils/base64';
import { CryptoKeyPair } from '../../src/utils/cryptography';
import { Logger } from '../../src/utils/logger';
import { newError } from '../../src/utils/new-error';

vi.mock('../../src/utils/new-error', () => ({
    newError: vi.fn().mockImplementation((logger, message) => new Error(message)),
}));

describe('SessionService', () => {
    let sessionService: ReturnType<typeof getSessionService>;
    let mockLogger: Logger;
    let mockBase64: Base64;
    let mockKeyPair: CryptoKeyPair;

    beforeEach(() => {
        mockLogger = createMockLogger();
        mockBase64 = createMockBase64({ '1,2,3': 'encoded-public-key' });
        mockKeyPair = createMockKeyPair();
        sessionService = getSessionService(mockLogger, mockBase64);
    });

    describe('initialize', () => {
        it('should accept a valid signing key pair', async () => {
            const config: SessionServiceConfig = {
                signingKeyPair: mockKeyPair,
            };

            await sessionService.initialize(config);

            expect(mockLogger.debug).toHaveBeenCalledWith('[session-service] Signing key pair found.');
        });

        it('should throw error when signing key pair is undefined', async () => {
            const config: SessionServiceConfig = {
                signingKeyPair: undefined as unknown as CryptoKeyPair,
            };

            await expect(sessionService.initialize(config)).rejects.toThrow(
                '[session-service] Failed to initialize. Incomplete signing key pair.',
            );
            expect(newError).toHaveBeenCalledWith(
                mockLogger,
                '[session-service] Failed to initialize. Incomplete signing key pair.',
            );
        });

        it('should throw error when signing key pair is null', async () => {
            const config: SessionServiceConfig = {
                signingKeyPair: null as unknown as CryptoKeyPair,
            };

            await expect(sessionService.initialize(config)).rejects.toThrow(
                '[session-service] Failed to initialize. Incomplete signing key pair.',
            );
            expect(newError).toHaveBeenCalledWith(
                mockLogger,
                '[session-service] Failed to initialize. Incomplete signing key pair.',
            );
        });
    });

    describe('signingKeyPair getter', () => {
        it('should return the signing key pair when initialized', async () => {
            const config: SessionServiceConfig = {
                signingKeyPair: mockKeyPair,
            };
            await sessionService.initialize(config);

            const result = sessionService.signingKeyPair;

            expect(result).toBe(mockKeyPair);
        });

        it('should throw error when accessed before initialization', () => {
            expect(() => sessionService.signingKeyPair).toThrow(
                '[session-service] Sign key pair has not initialized yet.',
            );
            expect(newError).toHaveBeenCalledWith(
                mockLogger,
                '[session-service] Sign key pair has not initialized yet.',
            );
        });
    });

    describe('signingPublicKeyBase64 getter', () => {
        it('should return the encoded public key when initialized', async () => {
            const config: SessionServiceConfig = {
                signingKeyPair: mockKeyPair,
            };
            await sessionService.initialize(config);

            const result = sessionService.signingPublicKeyBase64;

            expect(mockBase64.encode).toHaveBeenCalledWith(mockKeyPair.publicKey);
            expect(result).toBe('encoded-public-key');
        });

        it('should throw error when accessed before initialization', () => {
            expect(() => sessionService.signingPublicKeyBase64).toThrow(
                '[session-service] Sign key pair has not initialized yet.',
            );
            expect(newError).toHaveBeenCalledWith(
                mockLogger,
                '[session-service] Sign key pair has not initialized yet.',
            );
        });
    });

    describe('signingPublicKeyBase64Safe getter', () => {
        it('should return the encoded public key when initialized', async () => {
            const config: SessionServiceConfig = {
                signingKeyPair: mockKeyPair,
            };
            await sessionService.initialize(config);

            const result = sessionService.signingPublicKeyBase64Safe;

            expect(mockBase64.encode).toHaveBeenCalledWith(mockKeyPair.publicKey);
            expect(result).toBe('encoded-public-key');
        });

        it('should return undefined when accessed before initialization', () => {
            const result = sessionService.signingPublicKeyBase64Safe;

            expect(result).toBeUndefined();
            expect(mockBase64.encode).not.toHaveBeenCalled();
        });
    });
});
