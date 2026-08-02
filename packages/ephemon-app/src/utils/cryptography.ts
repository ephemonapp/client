export const KDF_ITERATIONS = 600000;
export const LEGACY_KDF_ITERATIONS = 100000;

const PAD_BLOCK = 256;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const DATA_KEY_LENGTH = 32;

export type Bytes = Uint8Array<ArrayBuffer>;

export interface WrappedKey {
    iv: Bytes;
    ciphertext: ArrayBuffer;
}

export interface EncryptedPayload {
    iv: Bytes;
    data: ArrayBuffer;
}

export interface Cryptography {
    getSalt(): Bytes;

    deriveKek(password: string, salt: Bytes, iterations: number): Promise<CryptoKey>;

    createDataKey(kek: CryptoKey): Promise<{ dataKey: CryptoKey; wrapped: WrappedKey }>;

    unwrapDataKey(kek: CryptoKey, wrapped: WrappedKey): Promise<CryptoKey>;

    encrypt(key: CryptoKey, value: unknown): Promise<EncryptedPayload>;

    decrypt<TypeData>(key: CryptoKey, payload: EncryptedPayload): Promise<TypeData>;

    legacyHashString(data: string): Promise<string>;

    legacyDeriveKey(password: string, salt: Bytes): Promise<CryptoKey>;

    legacyDecrypt<TypeData>(key: CryptoKey, iv: Bytes, encryptedData: Bytes): Promise<TypeData>;
}

function pad(payload: Uint8Array): Bytes {
    const total = Math.ceil((payload.length + 4) / PAD_BLOCK) * PAD_BLOCK;
    const padded = new Uint8Array(total);
    new DataView(padded.buffer).setUint32(0, payload.length, false);
    padded.set(payload, 4);
    return padded;
}

function unpad(padded: Bytes): Bytes {
    if (padded.length < 4) {
        throw new Error('[cryptography] Malformed padded plaintext.');
    }
    const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
    const length = view.getUint32(0, false);
    if (length > padded.length - 4) {
        throw new Error('[cryptography] Padded length header out of range.');
    }
    return padded.subarray(4, 4 + length);
}

export function getCryptography(): Cryptography {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    function getSalt(): Bytes {
        return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    }

    async function deriveKek(password: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
        const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'PBKDF2' }, false, [
            'deriveKey',
        ]);
        return await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt'],
        );
    }

    async function importDataKey(raw: Bytes): Promise<CryptoKey> {
        return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }

    async function createDataKey(kek: CryptoKey): Promise<{ dataKey: CryptoKey; wrapped: WrappedKey }> {
        const raw = crypto.getRandomValues(new Uint8Array(DATA_KEY_LENGTH));
        const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw);
        const dataKey = await importDataKey(raw);
        raw.fill(0);
        return { dataKey, wrapped: { iv, ciphertext } };
    }

    async function unwrapDataKey(kek: CryptoKey, wrapped: WrappedKey): Promise<CryptoKey> {
        const raw = new Uint8Array(
            await crypto.subtle.decrypt({ name: 'AES-GCM', iv: wrapped.iv }, kek, wrapped.ciphertext),
        );
        const dataKey = await importDataKey(raw);
        raw.fill(0);
        return dataKey;
    }

    async function encrypt(key: CryptoKey, value: unknown): Promise<EncryptedPayload> {
        const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
        const data = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            pad(encoder.encode(JSON.stringify(value))),
        );
        return { iv, data };
    }

    async function decrypt<TypeData>(key: CryptoKey, payload: EncryptedPayload): Promise<TypeData> {
        const padded = new Uint8Array(
            await crypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.iv }, key, payload.data),
        );
        return JSON.parse(decoder.decode(unpad(padded))) as TypeData;
    }

    async function legacyHashString(data: string): Promise<string> {
        const hashBytes = await crypto.subtle.digest('SHA-256', encoder.encode(data));
        return new TextDecoder().decode(hashBytes);
    }

    async function legacyDeriveKey(password: string, salt: Bytes): Promise<CryptoKey> {
        return await deriveKek(password, salt, LEGACY_KDF_ITERATIONS);
    }

    async function legacyDecrypt<TypeData>(key: CryptoKey, iv: Bytes, encryptedData: Bytes): Promise<TypeData> {
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encryptedData);
        return JSON.parse(decoder.decode(decrypted)) as TypeData;
    }

    return {
        getSalt,
        deriveKek,
        createDataKey,
        unwrapDataKey,
        encrypt,
        decrypt,
        legacyHashString,
        legacyDeriveKey,
        legacyDecrypt,
    };
}
