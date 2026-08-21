import { MemberNumber, toMemberNumber } from '../types/conversation';
import { Reader, Writer } from './byteCodec';

const MAGIC = Uint8Array.from([0x89, 0x45, 0x50, 0x4d]);
const FRAME_LABEL = 'Direct MLS bootstrap frame';
const HEADER_BYTES = 10;
export const ROUTING_ID_BYTES = 32;
export const MLS_GROUP_ID_BYTES = 32;

export const DIRECT_MLS_BOOTSTRAP_VERSION = 1;

export type MlsRosterMember = {
    memberNumber: MemberNumber;
    publicKey: string;
    serverUrl?: string;
    joinedEpoch?: string;
    name?: string;
};

export type DirectMlsMembership = {
    role: 'creator' | 'invitee';
    ownMemberNumber: MemberNumber;
    peerMemberNumber: MemberNumber;
    owner: MemberNumber;
    roster: ReadonlyArray<MlsRosterMember>;
};

export type DirectMlsBootstrapFrame =
    | { kind: 'hello'; minimumVersion: number; maximumVersion: number }
    | {
          kind: 'invite';
          routingId: Uint8Array;
          memberNumber: MemberNumber;
          owner: MemberNumber;
          roster: ReadonlyArray<MlsRosterMember>;
      }
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

export type DirectMlsRelayFrame = {
    kind: 'relay';
    routingId: Uint8Array;
    hops: number;
    message: Uint8Array;
};

export type DirectMlsCommitFrame = {
    kind: 'commit';
    routingId: Uint8Array;
    commit: Uint8Array;
};

export type DirectMlsWireFrame =
    DirectMlsBootstrapFrame | DirectMlsApplicationFrame | DirectMlsCommitFrame | DirectMlsRelayFrame;

const FRAME_KINDS = {
    hello: 1,
    initialize: 2,
    keyPackage: 3,
    addMember: 4,
    joined: 5,
    complete: 6,
    application: 7,
    commit: 8,
    invite: 9,
    relay: 10,
} as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function writeRoster(writer: Writer, roster: ReadonlyArray<MlsRosterMember>): void {
    writer.u32(roster.length);
    for (const member of roster) {
        writer.u32(member.memberNumber);
        writer.variable(encoder.encode(member.publicKey));
        writer.variable(encoder.encode(member.serverUrl ?? ''));
        writer.variable(encoder.encode(member.joinedEpoch ?? ''));
    }
}

function readRoster(reader: Reader): Array<MlsRosterMember> {
    const count = reader.u32();
    const roster: Array<MlsRosterMember> = [];
    for (let index = 0; index < count; index += 1) {
        const memberNumber = toMemberNumber(reader.u32());
        const publicKey = decoder.decode(reader.variable());
        const serverUrl = decoder.decode(reader.variable());
        const joinedEpoch = decoder.decode(reader.variable());
        roster.push({
            memberNumber,
            publicKey,
            serverUrl: serverUrl.length === 0 ? undefined : serverUrl,
            joinedEpoch: joinedEpoch.length === 0 ? undefined : joinedEpoch,
        });
    }
    return roster;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
    const shared = Math.min(left.byteLength, right.byteLength);
    for (let index = 0; index < shared; index++) {
        if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
    }
    return Math.sign(left.byteLength - right.byteLength);
}

export function assignDirectMlsMembership(
    ownPublicKey: string,
    peerPublicKey: string,
    peerServerUrl?: string,
): DirectMlsMembership {
    if (ownPublicKey.length === 0 || peerPublicKey.length === 0) {
        throw new Error('Direct MLS membership requires both authenticated transport identities');
    }
    const comparison = compareBytes(new TextEncoder().encode(ownPublicKey), new TextEncoder().encode(peerPublicKey));
    if (comparison === 0) throw new Error('Direct MLS bootstrap cannot connect an identity to itself');
    const creator = comparison < 0;
    const ownMemberNumber = toMemberNumber(creator ? 0 : 1);
    const peerMemberNumber = toMemberNumber(creator ? 1 : 0);
    return {
        role: creator ? 'creator' : 'invitee',
        ownMemberNumber,
        peerMemberNumber,
        owner: toMemberNumber(0),
        roster: [
            { memberNumber: ownMemberNumber, publicKey: ownPublicKey },
            { memberNumber: peerMemberNumber, publicKey: peerPublicKey, serverUrl: peerServerUrl },
        ].sort((left, right) => left.memberNumber - right.memberNumber),
    };
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
            writer.fixed(frame.groupId, MLS_GROUP_ID_BYTES, 'MLS group ID');
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
        case 'commit':
            writer.fixed(frame.routingId, ROUTING_ID_BYTES, 'Routing ID');
            writer.variable(frame.commit);
            break;
        case 'relay':
            writer.fixed(frame.routingId, ROUTING_ID_BYTES, 'Routing ID');
            writer.u8(frame.hops);
            writer.variable(frame.message);
            break;
        case 'invite':
            writer.fixed(frame.routingId, ROUTING_ID_BYTES, 'Routing ID');
            writer.u32(frame.memberNumber);
            writer.u32(frame.owner);
            writeRoster(writer, frame.roster);
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
    if (bytes.byteLength < HEADER_BYTES) throw new Error(`${FRAME_LABEL} header is truncated`);
    const version = bytes[4];
    if (version !== DIRECT_MLS_BOOTSTRAP_VERSION) {
        throw new Error(`Unsupported direct MLS bootstrap wire version ${version}`);
    }
    const payloadLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(6, false);
    if (payloadLength !== bytes.byteLength - HEADER_BYTES) {
        throw new Error('Direct MLS bootstrap payload length does not match the frame');
    }
    const reader = new Reader(bytes.slice(HEADER_BYTES), FRAME_LABEL);
    const routingId = () => reader.fixed(ROUTING_ID_BYTES);
    let frame: DirectMlsWireFrame;
    switch (bytes[5]) {
        case FRAME_KINDS.hello:
            frame = { kind: 'hello', minimumVersion: reader.u16(), maximumVersion: reader.u16() };
            break;
        case FRAME_KINDS.initialize:
            frame = { kind: 'initialize', routingId: routingId(), groupId: reader.fixed(MLS_GROUP_ID_BYTES) };
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
        case FRAME_KINDS.commit:
            frame = { kind: 'commit', routingId: routingId(), commit: reader.variable() };
            break;
        case FRAME_KINDS.relay:
            frame = { kind: 'relay', routingId: routingId(), hops: reader.u8(), message: reader.variable() };
            break;
        case FRAME_KINDS.invite:
            frame = {
                kind: 'invite',
                routingId: routingId(),
                memberNumber: toMemberNumber(reader.u32()),
                owner: toMemberNumber(reader.u32()),
                roster: readRoster(reader),
            };
            break;
        default:
            throw new Error(`Unknown direct MLS bootstrap frame kind ${bytes[5]}`);
    }
    reader.finish();
    return frame;
}

export function tryDecodeDirectMlsBootstrapFrame(bytes: Uint8Array): DirectMlsBootstrapFrame | undefined {
    const frame = tryDecodeDirectMlsWireFrame(bytes);
    if (frame?.kind === 'application' || frame?.kind === 'commit' || frame?.kind === 'relay') return undefined;
    return frame;
}
