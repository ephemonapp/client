const MAGIC = Uint8Array.from([0x89, 0x45, 0x50, 0x41]);
const VERSION = 1;
const CHAT_UPDATE_KIND = 1;
const HEADER_BYTES = 10;

/**
 * Versioned application payload carried inside an MLS PrivateMessage.
 * The compatibility chat update has no author field; authorship is attached
 * only after OpenMLS processing succeeds.
 */
export function encodeDirectMlsChatUpdate(json: string): Uint8Array {
    const payload = new TextEncoder().encode(json);
    const output = new Uint8Array(HEADER_BYTES + payload.byteLength);
    output.set(MAGIC, 0);
    output[4] = VERSION;
    output[5] = CHAT_UPDATE_KIND;
    new DataView(output.buffer).setUint32(6, payload.byteLength, false);
    output.set(payload, HEADER_BYTES);
    return output;
}

export function decodeDirectMlsChatUpdate(bytes: Uint8Array): string {
    if (bytes.byteLength < HEADER_BYTES) throw new Error('MLS application event header is truncated');
    if (!MAGIC.every((value, index) => bytes[index] === value)) {
        throw new Error('MLS application event magic does not match');
    }
    if (bytes[4] !== VERSION) throw new Error(`Unsupported MLS application event version ${bytes[4]}`);
    if (bytes[5] !== CHAT_UPDATE_KIND) throw new Error(`Unknown MLS application event kind ${bytes[5]}`);
    const payloadBytes = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(6, false);
    if (payloadBytes !== bytes.byteLength - HEADER_BYTES) {
        throw new Error('MLS application event payload length does not match the frame');
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(HEADER_BYTES));
}
