import { Logger } from './logger';
import { box, randomBytes, secretbox, secretbox_open, sign as naclSign } from './nacl-wrapper';
import { newError } from './new-error';

export interface CryptoKeyPair {
    readonly publicKey: Uint8Array;

    readonly secretKey: Uint8Array;
}

export interface Cryptography {
    sign(data: Uint8Array, secretKey: Uint8Array): Uint8Array;

    verifySignature(data: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;

    generateSigningKeyPair(): CryptoKeyPair;

    generateEncryptionKeyPair(): CryptoKeyPair;

    generateSharedSymmetricKey(publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array;

    encrypt(data: Uint8Array, secretKey: Uint8Array): Uint8Array;

    decrypt(data: Uint8Array, secretKey: Uint8Array): Uint8Array;
}

export function getCryptography(logger: Logger): Cryptography {
    return {
        sign(data: Uint8Array, secretKey: Uint8Array): Uint8Array {
            return naclSign.detached(data, secretKey);
        },
        verifySignature(data: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
            return naclSign.detached.verify(data, signature, publicKey);
        },
        generateSigningKeyPair(): CryptoKeyPair {
            return naclSign.keyPair();
        },
        generateEncryptionKeyPair(): CryptoKeyPair {
            return box.keyPair();
        },
        generateSharedSymmetricKey(publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array {
            return box.before(publicKey, secretKey);
        },
        encrypt(data: Uint8Array, secretKey: Uint8Array): Uint8Array {
            const nonce = randomBytes(secretbox.nonceLength);
            const ciphertext = secretbox(data, nonce, secretKey);
            if (!ciphertext) {
                throw newError(logger, '[cryptography] Encryption failed.');
            }
            const encrypted = new Uint8Array(nonce.length + ciphertext.length);
            encrypted.set(nonce);
            encrypted.set(ciphertext, nonce.length);
            return encrypted;
        },
        decrypt(data: Uint8Array, secretKey: Uint8Array): Uint8Array {
            const nonce = data.slice(0, secretbox.nonceLength);
            const ciphertext = data.slice(secretbox.nonceLength);
            const decrypted = secretbox_open(ciphertext, nonce, secretKey);
            if (!decrypted) {
                throw newError(logger, '[cryptography] Failed to decrypt data.');
            }
            return decrypted;
        },
    };
}
