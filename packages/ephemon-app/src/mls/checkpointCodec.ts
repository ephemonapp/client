import { Reader, Writer } from './byteCodec';

const MAGIC = 'EPHMLSCP';
const VERSION = 1;
const MAX_ENTRIES = 16_384;

/** What a conversation needs to come back: who this device is, which group, and the MLS storage behind it. */
export type MlsCheckpointParts = {
    identity: Uint8Array;
    signingPublicKey: Uint8Array;
    groupId: Uint8Array;
    keys: Uint8Array;
    keyLengths: Uint32Array;
    values: Uint8Array;
    valueLengths: Uint32Array;
};

export function encodeCheckpoint(parts: MlsCheckpointParts): Uint8Array {
    if (parts.keyLengths.length !== parts.valueLengths.length) {
        throw new Error('An MLS checkpoint carries a different number of keys and values');
    }
    if (parts.keyLengths.length > MAX_ENTRIES) {
        throw new Error(`An MLS checkpoint carries ${parts.keyLengths.length} storage entries`);
    }
    requireCovered(parts.keyLengths, parts.keys.byteLength, 'keys');
    requireCovered(parts.valueLengths, parts.values.byteLength, 'values');
    const writer = new Writer();
    writer.fixed(new TextEncoder().encode(MAGIC), MAGIC.length, 'checkpoint magic');
    writer.u16(VERSION);
    writer.variable(parts.identity);
    writer.variable(parts.signingPublicKey);
    writer.variable(parts.groupId);
    writer.u32(parts.keyLengths.length);
    for (const length of parts.keyLengths) writer.u32(length);
    for (const length of parts.valueLengths) writer.u32(length);
    writer.variable(parts.keys);
    writer.variable(parts.values);
    return writer.finish();
}

function requireCovered(lengths: Uint32Array, byteLength: number, field: string): void {
    let total = 0;
    for (const length of lengths) total += length;
    if (total !== byteLength) {
        throw new Error(`An MLS checkpoint's ${field} are ${byteLength} bytes but its lengths cover ${total}`);
    }
}

export function decodeCheckpoint(bytes: Uint8Array): MlsCheckpointParts {
    const reader = new Reader(bytes, 'MLS checkpoint');
    const magic = new TextDecoder().decode(reader.fixed(MAGIC.length));
    if (magic !== MAGIC) throw new Error('MLS checkpoint magic does not match');
    const version = reader.u16();
    if (version !== VERSION) throw new Error(`Unsupported MLS checkpoint version ${version}`);
    const identity = Uint8Array.from(reader.variable());
    const signingPublicKey = Uint8Array.from(reader.variable());
    const groupId = Uint8Array.from(reader.variable());
    const count = reader.u32();
    if (count > MAX_ENTRIES) throw new Error(`An MLS checkpoint carries ${count} storage entries`);
    const keyLengths = new Uint32Array(count);
    for (let index = 0; index < count; index += 1) keyLengths[index] = reader.u32();
    const valueLengths = new Uint32Array(count);
    for (let index = 0; index < count; index += 1) valueLengths[index] = reader.u32();
    const keys = Uint8Array.from(reader.variable());
    const values = Uint8Array.from(reader.variable());
    reader.finish();
    requireCovered(keyLengths, keys.byteLength, 'keys');
    requireCovered(valueLengths, values.byteLength, 'values');
    return { identity, signingPublicKey, groupId, keys, keyLengths, values, valueLengths };
}
