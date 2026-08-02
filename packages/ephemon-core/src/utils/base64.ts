import { decodeBase64, encodeBase64 } from './nacl-util-wrapper';

export interface Base64 {
    decode(input: string): Uint8Array;

    encode(input: Uint8Array): string;
}

export function getBase64(): Base64 {
    return {
        decode(input: string): Uint8Array {
            return decodeBase64(input);
        },
        encode(input: Uint8Array): string {
            return encodeBase64(input);
        },
    };
}
