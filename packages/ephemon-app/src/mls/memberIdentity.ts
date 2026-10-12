import { MemberNumber, toMemberNumber } from '../types/conversation';
import { Reader, Writer } from './byteCodec';

const IDENTITY_BYTES = 4;

/** The credential identity this app gives a member: its group-scoped number, big-endian. */
export function identityOf(memberNumber: MemberNumber): Uint8Array {
    const writer = new Writer();
    writer.u32(Number(memberNumber));
    return writer.finish();
}

export function memberNumberOf(identity: Uint8Array): MemberNumber {
    if (identity.byteLength !== IDENTITY_BYTES) {
        throw new RangeError(`A member identity must be ${IDENTITY_BYTES} bytes, received ${identity.byteLength}`);
    }
    const reader = new Reader(identity, 'member identity');
    const memberNumber = toMemberNumber(reader.u32());
    reader.finish();
    return memberNumber;
}

export function decodeIdentities(bytes: Uint8Array, lengths: ArrayLike<number>): Array<Uint8Array> {
    const identities: Array<Uint8Array> = [];
    let offset = 0;
    for (let index = 0; index < lengths.length; index += 1) {
        const end = offset + lengths[index];
        if (end > bytes.byteLength) throw new RangeError('Member identities are truncated');
        identities.push(bytes.slice(offset, end));
        offset = end;
    }
    if (offset !== bytes.byteLength) throw new RangeError('Member identities carry trailing bytes');
    return identities;
}

export function memberNumbersOf(bytes: Uint8Array, lengths: ArrayLike<number>): Array<MemberNumber> {
    return decodeIdentities(bytes, lengths).map(memberNumberOf);
}
