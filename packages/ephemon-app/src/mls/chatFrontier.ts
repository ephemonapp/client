import { ChatEventRecord } from '../types/chatRecord';
import { MemberNumber, toMemberNumber } from '../types/conversation';
import { MLS_EVENT_HASH_BYTES, isMlsEventId, mlsEventHash } from '../types/eventId';
import { Reader, Writer } from './byteCodec';
import { CommitHead, decodeCommitHead, encodeCommitHead } from './commitLog';

export type ChatFrontierRange = { from: number; to: number };

export type ChatAuthorFrontier = {
    author: MemberNumber;
    contiguous: number;
    head?: Uint8Array;
    holes: ReadonlyArray<ChatFrontierRange>;
};

export type ChatFrontier = ReadonlyArray<ChatAuthorFrontier>;

export type ChatInventory = {
    head?: CommitHead;
    frontier: ChatFrontier;
};

export type ChatClearedFrontier = ReadonlyArray<{ author: MemberNumber; through: number }>;

const FRONTIER_LABEL = 'MLS chat frontier';
const MAX_RANGES = 64;

export function computeChatFrontier(
    records: ReadonlyArray<ChatEventRecord>,
    cleared: ChatClearedFrontier = [],
    roster: ReadonlyArray<MemberNumber> = [],
): ChatFrontier {
    const bySequence = new Map<MemberNumber, Map<number, Uint8Array>>();
    for (const author of roster) {
        if (!bySequence.has(author)) bySequence.set(author, new Map());
    }
    for (const entry of cleared) {
        if (!bySequence.has(entry.author)) bySequence.set(entry.author, new Map());
    }
    for (const record of records) {
        if (record.author === undefined || record.sequence === undefined || !isMlsEventId(record.id)) continue;
        let sequences = bySequence.get(record.author);
        if (sequences === undefined) {
            sequences = new Map();
            bySequence.set(record.author, sequences);
        }
        sequences.set(record.sequence, mlsEventHash(record.id));
    }

    const frontier: Array<ChatAuthorFrontier> = [];
    for (const [author, sequences] of [...bySequence].sort((left, right) => left[0] - right[0])) {
        const clearedThrough = cleared.find((entry) => entry.author === author)?.through ?? -1;
        const present = [...sequences.keys()].sort((left, right) => left - right);
        const highest = Math.max(clearedThrough, present.length === 0 ? -1 : present[present.length - 1]);
        let contiguous = clearedThrough;
        while (sequences.has(contiguous + 1)) contiguous += 1;

        const holes: Array<ChatFrontierRange> = [];
        let cursor = contiguous + 1;
        while (cursor <= highest && holes.length < MAX_RANGES) {
            if (sequences.has(cursor)) {
                cursor += 1;
                continue;
            }
            const from = cursor;
            while (cursor <= highest && !sequences.has(cursor)) cursor += 1;
            holes.push({ from, to: cursor - 1 });
        }

        frontier.push({
            author,
            contiguous,
            head: sequences.get(contiguous),
            holes,
        });
    }
    return frontier;
}

export function clampOwnAuthorFrontier(
    frontier: ChatFrontier,
    own: MemberNumber,
    authoredSequences: number,
): ChatFrontier {
    if (authoredSequences <= 0) return frontier;
    const highest = authoredSequences - 1;
    return frontier.map((entry) =>
        entry.author === own && entry.contiguous < highest && entry.holes.length === 0
            ? { ...entry, contiguous: highest, head: undefined }
            : entry,
    );
}

export function missingForPeer(
    peer: ChatFrontier,
    own: ChatFrontier,
): ReadonlyArray<ChatFrontierRange & { author: MemberNumber }> {
    const wanted: Array<ChatFrontierRange & { author: MemberNumber }> = [];
    for (const mine of own) {
        const theirs = peer.find((entry) => entry.author === mine.author);
        const highest = mine.holes.length === 0 ? mine.contiguous : Math.max(mine.contiguous, lastHoleEnd(mine));
        if (theirs === undefined) {
            if (highest >= 0) wanted.push({ author: mine.author, from: 0, to: highest });
            continue;
        }
        for (const hole of theirs.holes) {
            wanted.push({ author: mine.author, from: hole.from, to: hole.to });
        }
        if (highest > theirs.contiguous) {
            const from = theirs.holes.length === 0 ? theirs.contiguous + 1 : lastHoleEnd(theirs) + 1;
            if (from <= highest) wanted.push({ author: mine.author, from, to: highest });
        }
    }
    return wanted;
}

function lastHoleEnd(entry: ChatAuthorFrontier): number {
    return entry.holes.length === 0 ? entry.contiguous : entry.holes[entry.holes.length - 1].to;
}

export function encodeChatInventory(inventory: ChatInventory): Uint8Array {
    const writer = new Writer();
    writer.u8(inventory.head === undefined ? 0 : 1);
    if (inventory.head !== undefined) writer.variable(encodeCommitHead(inventory.head));
    writer.variable(encodeChatFrontier(inventory.frontier));
    return writer.finish();
}

export function decodeChatInventory(bytes: Uint8Array): ChatInventory {
    const reader = new Reader(bytes, FRONTIER_LABEL);
    const presence = reader.u8();
    if (presence !== 0 && presence !== 1) throw new Error(`Unknown head presence in a ${FRONTIER_LABEL}`);
    const head = presence === 1 ? decodeCommitHead(reader.variable()) : undefined;
    const frontier = decodeChatFrontier(reader.variable());
    reader.finish();
    return { head, frontier };
}

export function encodeChatFrontier(frontier: ChatFrontier): Uint8Array {
    const writer = new Writer();
    writer.u32(frontier.length);
    for (const entry of frontier) {
        writer.u32(entry.author);
        writer.u64(BigInt(entry.contiguous + 1));
        writer.u8(entry.head === undefined ? 0 : 1);
        if (entry.head !== undefined) writer.fixed(entry.head, MLS_EVENT_HASH_BYTES, 'Frontier head');
        if (entry.holes.length > MAX_RANGES) throw new Error(`A ${FRONTIER_LABEL} carries too many holes`);
        writer.u32(entry.holes.length);
        for (const hole of entry.holes) {
            writer.u64(BigInt(hole.from));
            writer.u64(BigInt(hole.to));
        }
    }
    return writer.finish();
}

export function decodeChatFrontier(bytes: Uint8Array): ChatFrontier {
    const reader = new Reader(bytes, FRONTIER_LABEL);
    const entries = reader.u32();
    const frontier: Array<ChatAuthorFrontier> = [];
    for (let index = 0; index < entries; index += 1) {
        const author = toMemberNumber(reader.u32());
        const contiguous = safeSequence(reader.u64()) - 1;
        const presence = reader.u8();
        if (presence !== 0 && presence !== 1) throw new Error(`Unknown head presence in a ${FRONTIER_LABEL}`);
        const head = presence === 1 ? reader.fixed(MLS_EVENT_HASH_BYTES) : undefined;
        const holeCount = reader.u32();
        if (holeCount > MAX_RANGES) throw new Error(`A ${FRONTIER_LABEL} carries too many holes`);
        const holes: Array<ChatFrontierRange> = [];
        let lowest = contiguous;
        for (let hole = 0; hole < holeCount; hole += 1) {
            const from = safeSequence(reader.u64());
            const to = safeSequence(reader.u64());
            if (from <= lowest || to < from) throw new Error(`A ${FRONTIER_LABEL} carries an unordered hole`);
            lowest = to;
            holes.push({ from, to });
        }
        frontier.push({ author, contiguous, head, holes });
    }
    reader.finish();
    return frontier;
}

function safeSequence(value: bigint): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`A ${FRONTIER_LABEL} sequence is out of range`);
    return Number(value);
}
