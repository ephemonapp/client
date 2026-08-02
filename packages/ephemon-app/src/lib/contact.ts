import { Contact, decodeContact, encodeContact } from '@ephemon/core';

export function contactCode(publicKey: string, serverUrl: string | undefined): string {
    try {
        return encodeContact(publicKey, serverUrl);
    } catch {
        return publicKey;
    }
}

export function readContact(code: string): Contact | undefined {
    try {
        return decodeContact(code);
    } catch {
        return undefined;
    }
}
