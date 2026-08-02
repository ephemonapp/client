import { createMockLogger } from '../../__mocks__/test-utils';
import { getCryptography } from '../../src/utils/cryptography';
import { Logger } from '../../src/utils/logger';
import { secretbox, sign } from '../../src/utils/nacl-wrapper';

describe('Cryptography utility', () => {
    let cryptography: ReturnType<typeof getCryptography>;
    let mockLogger: Logger;

    beforeEach(() => {
        vi.clearAllMocks();
        mockLogger = createMockLogger();
        cryptography = getCryptography(mockLogger);
    });

    describe('sign', () => {
        it('should sign data with a secret key', () => {
            const data = new Uint8Array([1, 2, 3, 4]);
            const keyPair = sign.keyPair();

            const signature = cryptography.sign(data, keyPair.secretKey);

            expect(signature).toBeInstanceOf(Uint8Array);
            expect(signature.length).toBe(64);

            const isValid = sign.detached.verify(data, signature, keyPair.publicKey);
            expect(isValid).toBe(true);
        });
    });

    describe('verifySignature', () => {
        it('should verify a valid signature', () => {
            const data = new Uint8Array([1, 2, 3, 4]);
            const keyPair = sign.keyPair();
            const signature = sign.detached(data, keyPair.secretKey);

            const result = cryptography.verifySignature(data, signature, keyPair.publicKey);

            expect(result).toBe(true);
        });

        it('should reject an invalid signature', () => {
            const data = new Uint8Array([1, 2, 3, 4]);
            const keyPair = sign.keyPair();
            const wrongKeyPair = sign.keyPair();
            const signature = sign.detached(data, wrongKeyPair.secretKey);

            const result = cryptography.verifySignature(data, signature, keyPair.publicKey);

            expect(result).toBe(false);
        });

        it('should reject if data has been tampered with', () => {
            const originalData = new Uint8Array([1, 2, 3, 4]);
            const tamperedData = new Uint8Array([1, 2, 3, 5]);
            const keyPair = sign.keyPair();
            const signature = sign.detached(originalData, keyPair.secretKey);

            const result = cryptography.verifySignature(tamperedData, signature, keyPair.publicKey);

            expect(result).toBe(false);
        });
    });

    describe('generateSigningKeyPair', () => {
        it('should generate a valid signing key pair', () => {
            const keyPair = cryptography.generateSigningKeyPair();

            expect(keyPair).toBeDefined();
            expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
            expect(keyPair.secretKey).toBeInstanceOf(Uint8Array);
            expect(keyPair.publicKey.length).toBe(32);
            expect(keyPair.secretKey.length).toBe(64);

            const data = new Uint8Array([1, 2, 3, 4]);
            const signature = cryptography.sign(data, keyPair.secretKey);
            const isValid = cryptography.verifySignature(data, signature, keyPair.publicKey);
            expect(isValid).toBe(true);
        });
    });

    describe('generateEncryptionKeyPair', () => {
        it('should generate a valid encryption key pair', () => {
            const keyPair = cryptography.generateEncryptionKeyPair();

            expect(keyPair).toBeDefined();
            expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
            expect(keyPair.secretKey).toBeInstanceOf(Uint8Array);
            expect(keyPair.publicKey.length).toBe(32);
            expect(keyPair.secretKey.length).toBe(32);
        });
    });

    describe('generateSharedSymmetricKey', () => {
        it('should generate a shared key that both parties can derive', () => {
            const aliceKeyPair = cryptography.generateEncryptionKeyPair();
            const bobKeyPair = cryptography.generateEncryptionKeyPair();

            const aliceSharedKey = cryptography.generateSharedSymmetricKey(
                bobKeyPair.publicKey,
                aliceKeyPair.secretKey,
            );

            const bobSharedKey = cryptography.generateSharedSymmetricKey(aliceKeyPair.publicKey, bobKeyPair.secretKey);

            expect(aliceSharedKey).toEqual(bobSharedKey);
            expect(aliceSharedKey.length).toBe(32);
        });
    });

    describe('encrypt and decrypt', () => {
        it('should encrypt and decrypt data correctly', () => {
            const originalData = new Uint8Array([1, 2, 3, 4, 5]);
            const keyPair = cryptography.generateEncryptionKeyPair();
            const sharedKey = cryptography.generateSharedSymmetricKey(keyPair.publicKey, keyPair.secretKey);

            const encrypted = cryptography.encrypt(originalData, sharedKey);

            expect(encrypted.length).toBeGreaterThan(originalData.length);
            expect(encrypted.length).toBe(originalData.length + secretbox.nonceLength + 16);

            const decrypted = cryptography.decrypt(encrypted, sharedKey);

            expect(decrypted).toEqual(originalData);
        });

        it('should throw an error when encryption fails', async () => {
            vi.resetModules();
            vi.doMock('../../src/utils/nacl-wrapper', async (importOriginal) => ({
                ...(await importOriginal<typeof import('../../src/utils/nacl-wrapper')>()),
                secretbox: vi.fn(() => null),
            }));
            const { getCryptography } = await import('../../src/utils/cryptography');
            const cryptographyWithMock = getCryptography(mockLogger);
            const originalData = new Uint8Array([1, 2, 3, 4, 5]);
            const secretKey = new Uint8Array(32);
            expect(() => {
                cryptographyWithMock.encrypt(originalData, secretKey);
            }).toThrow('[cryptography] Encryption failed.');
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should throw an error when decryption fails due to wrong key', () => {
            const originalData = new Uint8Array([1, 2, 3, 4, 5]);
            const correctKeyPair = cryptography.generateEncryptionKeyPair();
            const wrongKeyPair = cryptography.generateEncryptionKeyPair();

            const correctSharedKey = cryptography.generateSharedSymmetricKey(
                correctKeyPair.publicKey,
                correctKeyPair.secretKey,
            );

            const wrongSharedKey = cryptography.generateSharedSymmetricKey(
                wrongKeyPair.publicKey,
                wrongKeyPair.secretKey,
            );

            const encrypted = cryptography.encrypt(originalData, correctSharedKey);

            expect(() => {
                cryptography.decrypt(encrypted, wrongSharedKey);
            }).toThrow('[cryptography] Failed to decrypt data.');
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should throw an error when decryption fails due to data tampering', () => {
            const originalData = new Uint8Array([1, 2, 3, 4, 5]);
            const keyPair = cryptography.generateEncryptionKeyPair();
            const sharedKey = cryptography.generateSharedSymmetricKey(keyPair.publicKey, keyPair.secretKey);

            const encrypted = cryptography.encrypt(originalData, sharedKey);

            const tampered = new Uint8Array(encrypted);
            tampered[secretbox.nonceLength + 1] ^= 1;

            expect(() => {
                cryptography.decrypt(tampered, sharedKey);
            }).toThrow('[cryptography] Failed to decrypt data.');
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });
});
