import { decodeUTF8, encodeUTF8 } from './nacl-util-wrapper';

export interface Utf8 {
    decode(input: string): Uint8Array;

    encode(input: Uint8Array): string;
}

export function getUtf8(): Utf8 {
    return {
        decode(input: string): Uint8Array {
            return decodeUTF8(input);
        },
        encode(input: Uint8Array): string {
            return encodeUTF8(input);
        },
    };
}
