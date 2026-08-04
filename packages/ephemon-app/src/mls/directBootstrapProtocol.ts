import { MemberNumber, toMemberNumber } from '../types/conversation';

const MAGIC = Uint8Array.from([0x89, 0x45, 0x50, 0x4d]);
const HEADER_BYTES = 10;
const ROUTING_ID_BYTES = 32;
const GROUP_ID_BYTES = 32;

export const DIRECT_MLS_BOOTSTRAP_VERSION = 1;

export type DirectMlsMembership = {
    role: 'creator' | 'invitee';
    ownMemberNumber: MemberNumber;
    peerMemberNumber: MemberNumber;
};

export type DirectMlsBootstrapFrame =
    | { kind: 'hello'; minimumVersion: number; maximumVersion: number }
    | { kind: 'initialize'; routingId: Uint8Array; groupId: Uint8Array }
    | { kind: 'keyPackage'; routingId: Uint8Array; keyPackage: Uint8Array }
    | { kind: 'addMember'; routingId: Uint8Array; commit: Uint8Array; welcome: Uint8Array }
    | { kind: 'joined'; routingId: Uint8Array; epoch: bigint }
    | { kind: 'complete'; routingId: Uint8Array; epoch: bigint };

export type DirectMlsApplicationFrame = {
    kind: 'application';
    routingId: Uint8Array;
    message: Uint8Array;
};

export type DirectMlsWireFrame = DirectMlsBootstrapFrame | DirectMlsApplicationFrame;

const FRAME_KINDS = {
    hello: 1,
    initialize: 2,
    keyPackage: 3,
    addMember: 4,
    joined: 5,
    complete: 6,
    application: 7,
} as const;

function compareBytes(left: Uint8Array, right: Uint8Array): number {
    const shared = Math.min(left.byteLength, right.byteLength);
    for (let index = 0; index < shared; index++) {
        if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
    }
    return Math.sign(left.byteLength - right.byteLength);
}

export function assignDirectMlsMembership(ownPublicKey: string, peerPublicKey: string): DirectMlsMembership {
    if (ownPublicKey.length === 0 || peerPublicKey.length === 0) {
        throw new Error('Direct MLS membership requires both authenticated transport identities');
    }
    const comparison = compareBytes(new TextEncoder().encode(ownPublicKey), new TextEncoder().encode(peerPublicKey));
    if (comparison === 0) throw new Error('Direct MLS bootstrap cannot connect an identity to itself');
    const creator = comparison < 0;
    return {
        role: creator ? 'creator' : 'invitee',
        ownMemberNumber: toMemberNumber(creator ? 0 : 1),
        peerMemberNumber: toMemberNumber(creator ? 1 : 0),
    };
}

class Writer {
    private readonly chunks: Array<Uint8Array> = [];
    private byteLength = 0;

    u16(value: number): void {
        if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error('Value does not fit uint16');
        const bytes = new Uint8Array(2);
        new DataView(bytes.buffer).setUint16(0, value, false);
        this.push(bytes);
    }

    u32(value: number): void {
        if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('Value does not fit uint32');
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setUint32(0, value, false);
        this.push(bytes);
    }

    u64(value: bigint): void {
        if (value < 0n || value > 0xffffffffffffffffn) throw new Error('Value does not fit uint64');
        const bytes = new Uint8Array(8);
        new DataView(bytes.buffer).setBigUint64(0, value, false);
        this.push(bytes);
    }

    fixed(value: Uint8Array, expectedBytes: number, field: string): void {
        if (value.byteLength !== expectedBytes) throw new Error(`${field} must contain exactly ${expectedBytes} bytes`);
        this.push(value);
    }

    variable(value: Uint8Array): void {
        this.u32(value.byteLength);
        this.push(value);
    }

    finish(): Uint8Array {
        const output = new Uint8Array(this.byteLength);
        let offset = 0;
        for (const chunk of this.chunks) {
            output.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return output;
    }

    private push(value: Uint8Array): void {
        this.chunks.push(value);
        this.byteLength += value.byteLength;
    }
}

class Reader {
    private offset = 0;

    constructor(private readonly bytes: Uint8Array) {}

    u16(): number {
        const value = new DataView(this.take(2).buffer).getUint16(0, false);
        return value;
    }

    u32(): number {
        const value = new DataView(this.take(4).buffer).getUint32(0, false);
        return value;
    }

    u64(): bigint {
        return new DataView(this.take(8).buffer).getBigUint64(0, false);
    }

    fixed(byteLength: number): Uint8Array {
        return this.take(byteLength);
    }

    variable(): Uint8Array {
        return this.take(this.u32());
    }

    finish(): void {
        if (this.offset !== this.bytes.byteLength)
            throw new Error('Direct MLS bootstrap frame contains trailing bytes');
    }

    private take(byteLength: number): Uint8Array {
        const end = this.offset + byteLength;
        if (!Number.isSafeInteger(end) || end > this.bytes.byteLength) {
            throw new Error('Direct MLS bootstrap frame is truncated');
        }
        const value = this.bytes.slice(this.offset, end);
        this.offset = end;
        return value;
    }
}

function encodePayload(frame: DirectMlsWireFrame): Uint8Array {
    const writer = new Writer();
    switch (frame.kind) {
        case 'hello':
            writer.u16(frame.minimumVersion);
            writer.u16(frame.maximumVersion);
            break;
        case 'initialize':
            writer.fixed(frame.routingId, ROUTING_ID_BYTES, 'Routing ID');
            writer.fixed(frame.groupId, GROUP_ID_BYTES, 'MLS group ID');
            break;
        case 'keyPackage':
            writer.fixed(frame.routingId, ROUTING_ID_BYTES, 'Routing ID');
            writer.variable(frame.keyPackage);
            break;
        case 'addMember':
            writer.fixed(frame.routingId, ROUTING_ID_BYTES, 'Routing ID');
            writer.variable(frame.commit);
            writer.variable(frame.welcome);
            break;
        case 'joined':
        case 'complete':
            writer.fixed(frame.routingId, ROUTING_ID_BYTES, 'Routing ID');
            writer.u64(frame.epoch);
            break;
        case 'application':
            writer.fixed(frame.routingId, ROUTING_ID_BYTES, 'Routing ID');
            writer.variable(frame.message);
            break;
    }
    return writer.finish();
}

export function encodeDirectMlsWireFrame(frame: DirectMlsWireFrame): Uint8Array {
    const payload = encodePayload(frame);
    const output = new Uint8Array(HEADER_BYTES + payload.byteLength);
    output.set(MAGIC, 0);
    output[4] = DIRECT_MLS_BOOTSTRAP_VERSION;
    output[5] = FRAME_KINDS[frame.kind];
    new DataView(output.buffer).setUint32(6, payload.byteLength, false);
    output.set(payload, HEADER_BYTES);
    return output;
}

export function encodeDirectMlsBootstrapFrame(frame: DirectMlsBootstrapFrame): Uint8Array {
    return encodeDirectMlsWireFrame(frame);
}

function hasMagic(bytes: Uint8Array): boolean {
    if (bytes.byteLength < MAGIC.byteLength) return false;
    return MAGIC.every((value, index) => bytes[index] === value);
}

export function tryDecodeDirectMlsWireFrame(bytes: Uint8Array): DirectMlsWireFrame | undefined {
    if (!hasMagic(bytes)) return undefined;
    if (bytes.byteLength < HEADER_BYTES) throw new Error('Direct MLS bootstrap header is truncated');
    const version = bytes[4];
    if (version !== DIRECT_MLS_BOOTSTRAP_VERSION) {
        throw new Error(`Unsupported direct MLS bootstrap wire version ${version}`);
    }
    const payloadLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(6, false);
    if (payloadLength !== bytes.byteLength - HEADER_BYTES) {
        throw new Error('Direct MLS bootstrap payload length does not match the frame');
    }
    const reader = new Reader(bytes.slice(HEADER_BYTES));
    const routingId = () => reader.fixed(ROUTING_ID_BYTES);
    let frame: DirectMlsWireFrame;
    switch (bytes[5]) {
        case FRAME_KINDS.hello:
            frame = { kind: 'hello', minimumVersion: reader.u16(), maximumVersion: reader.u16() };
            break;
        case FRAME_KINDS.initialize:
            frame = { kind: 'initialize', routingId: routingId(), groupId: reader.fixed(GROUP_ID_BYTES) };
            break;
        case FRAME_KINDS.keyPackage:
            frame = { kind: 'keyPackage', routingId: routingId(), keyPackage: reader.variable() };
            break;
        case FRAME_KINDS.addMember:
            frame = {
                kind: 'addMember',
                routingId: routingId(),
                commit: reader.variable(),
                welcome: reader.variable(),
            };
            break;
        case FRAME_KINDS.joined:
            frame = { kind: 'joined', routingId: routingId(), epoch: reader.u64() };
            break;
        case FRAME_KINDS.complete:
            frame = { kind: 'complete', routingId: routingId(), epoch: reader.u64() };
            break;
        case FRAME_KINDS.application:
            frame = { kind: 'application', routingId: routingId(), message: reader.variable() };
            break;
        default:
            throw new Error(`Unknown direct MLS bootstrap frame kind ${bytes[5]}`);
    }
    reader.finish();
    return frame;
}

export function tryDecodeDirectMlsBootstrapFrame(bytes: Uint8Array): DirectMlsBootstrapFrame | undefined {
    const frame = tryDecodeDirectMlsWireFrame(bytes);
    return frame?.kind === 'application' ? undefined : frame;
}
