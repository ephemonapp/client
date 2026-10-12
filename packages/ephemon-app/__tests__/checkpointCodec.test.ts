import { decodeCheckpoint, encodeCheckpoint, MlsCheckpointParts } from '../src/mls/checkpointCodec';

const parts: MlsCheckpointParts = {
    identity: Uint8Array.of(0, 0, 0, 2),
    signingPublicKey: Uint8Array.of(9, 9, 9),
    groupId: Uint8Array.of(1, 2, 3, 4),
    keys: Uint8Array.of(1, 2, 2, 3, 3, 3),
    keyLengths: Uint32Array.of(1, 2, 3),
    values: Uint8Array.of(7, 8, 8, 9, 9, 9, 9),
    valueLengths: Uint32Array.of(1, 2, 4),
};

describe('the checkpoint container', () => {
    it('round trips every part', () => {
        expect(decodeCheckpoint(encodeCheckpoint(parts))).toEqual(parts);
    });

    it('round trips a client that has no group yet', () => {
        const withoutGroup: MlsCheckpointParts = { ...parts, groupId: new Uint8Array() };

        expect(decodeCheckpoint(encodeCheckpoint(withoutGroup))).toEqual(withoutGroup);
    });

    it('round trips empty storage', () => {
        const empty: MlsCheckpointParts = {
            ...parts,
            keys: new Uint8Array(),
            keyLengths: new Uint32Array(),
            values: new Uint8Array(),
            valueLengths: new Uint32Array(),
        };

        expect(decodeCheckpoint(encodeCheckpoint(empty))).toEqual(empty);
    });

    it('refuses bytes that do not start with its magic', () => {
        const bytes = encodeCheckpoint(parts);
        bytes[0] = 0;

        expect(() => decodeCheckpoint(bytes)).toThrow(/magic/);
    });

    it('refuses a version it does not know', () => {
        const bytes = encodeCheckpoint(parts);
        bytes[9] = 7;

        expect(() => decodeCheckpoint(bytes)).toThrow(/version/);
    });

    it('refuses trailing bytes', () => {
        const bytes = encodeCheckpoint(parts);

        expect(() => decodeCheckpoint(Uint8Array.from([...bytes, 0]))).toThrow();
    });

    it('refuses halves that disagree on how many entries there are', () => {
        expect(() => encodeCheckpoint({ ...parts, valueLengths: Uint32Array.of(1, 2) })).toThrow(/keys and values/);
    });

    it('refuses more storage entries than the limit', () => {
        expect(() =>
            encodeCheckpoint({ ...parts, keyLengths: new Uint32Array(16_385), valueLengths: new Uint32Array(16_385) }),
        ).toThrow(/storage entries/);
    });
});

describe('length coverage', () => {
    it('refuses lengths that do not cover the key bytes', () => {
        expect(() => encodeCheckpoint({ ...parts, keyLengths: Uint32Array.of(1, 2, 2) })).toThrow(/keys/);
    });

    it('refuses lengths that do not cover the value bytes', () => {
        expect(() => encodeCheckpoint({ ...parts, valueLengths: Uint32Array.of(1, 2, 3) })).toThrow(/values/);
    });

    it('names the corrupt field when decoding truncated bytes', () => {
        const bytes = encodeCheckpoint(parts);
        const decoded = () => decodeCheckpoint(bytes.slice(0, bytes.byteLength - 1));

        expect(decoded).toThrow();
    });
});
