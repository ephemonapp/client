import { MLS_EVENT_HASH_BYTES } from '../types/eventId';
import { Reader, Writer } from './byteCodec';

const CHAIN_VERSION = 1;
const CHAIN_LABEL = 'MLS chat chain state';

/** Authoring position of the local member: the next sequence to use and the hash of its last event. */
export type ChatChainState = {
    sequence: number;
    head?: Uint8Array;
};

export function encodeChatChainState(state: ChatChainState): Uint8Array {
    if (!Number.isSafeInteger(state.sequence) || state.sequence < 0) {
        throw new Error('A chain sequence must be a non-negative safe integer');
    }
    if (state.head === undefined && state.sequence !== 0) {
        throw new Error('Only an empty chain may omit its head');
    }
    const writer = new Writer();
    writer.u8(CHAIN_VERSION);
    writer.u64(BigInt(state.sequence));
    writer.u8(state.head === undefined ? 0 : 1);
    if (state.head !== undefined) writer.fixed(state.head, MLS_EVENT_HASH_BYTES, 'Chain head');
    return writer.finish();
}

export function decodeChatChainState(bytes: Uint8Array): ChatChainState {
    const reader = new Reader(bytes, CHAIN_LABEL);
    const version = reader.u8();
    if (version !== CHAIN_VERSION) throw new Error(`Unsupported ${CHAIN_LABEL} version ${version}`);
    const sequence = reader.u64();
    if (sequence > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`A ${CHAIN_LABEL} sequence is out of range`);
    const presence = reader.u8();
    if (presence !== 0 && presence !== 1) throw new Error(`Unknown head presence ${presence} in a ${CHAIN_LABEL}`);
    const head = presence === 1 ? reader.fixed(MLS_EVENT_HASH_BYTES) : undefined;
    reader.finish();
    if (head === undefined && sequence !== 0n) throw new Error('Only an empty chain may omit its head');
    return { sequence: Number(sequence), head };
}
