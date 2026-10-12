import { ChatEventRecord } from '../types/chatRecord';
import { MemberNumber, toMemberNumber } from '../types/conversation';
import { isMlsEventId } from '../types/eventId';
import { Reader, Writer } from './byteCodec';
import { CommitHead, decodeCommitHead, encodeCommitHead } from './commitLog';

export type ChatFrontierRange = { from: number; to: number };

export type ChatAuthorFrontier = {
    author: MemberNumber;
    contiguous: number;
    highest: number;
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
    const bySequence = new Map<MemberNumber, Set<number>>();
    for (const author of roster) {
        if (!bySequence.has(author)) bySequence.set(author, new Set());
    }
    for (const entry of cleared) {
        if (!bySequence.has(entry.author)) bySequence.set(entry.author, new Set());
    }
    for (const record of records) {
        if (record.author === undefined || record.sequence === undefined || !isMlsEventId(record.id)) continue;
        let sequences = bySequence.get(record.author);
        if (sequences === undefined) {
            sequences = new Set();
            bySequence.set(record.author, sequences);
        }
        sequences.add(record.sequence);
    }

    const frontier: Array<ChatAuthorFrontier> = [];
    for (const [author, sequences] of [...bySequence].sort((left, right) => left[0] - right[0])) {
        const clearedThrough = cleared.find((entry) => entry.author === author)?.through ?? -1;
        const present = [...sequences].sort((left, right) => left - right);
        const highest = Math.max(clearedThrough, present.length === 0 ? -1 : present[present.length - 1]);
        let contiguous = clearedThrough;
        while (sequences.has(contiguous + 1)) contiguous += 1;

        const holes: Array<ChatFrontierRange> = [];
        let previous = contiguous;
        let truncated = false;
        for (const sequence of present) {
            if (sequence <= contiguous) continue;
            if (sequence > previous + 1) {
                if (holes.length >= MAX_RANGES) {
                    truncated = true;
                    break;
                }
                holes.push({ from: previous + 1, to: sequence - 1 });
            }
            previous = sequence;
        }

        frontier.push({ author, contiguous, highest: truncated ? previous : highest, holes });
    }
    return frontier;
}

/**
 * Advertises where this member is authoring from when it holds none of its own events. A member that holds some of them
 * is left alone: a gap below its chain head is a lost event, and hiding it stops peers from ever pushing it back.
 */
export function clampOwnAuthorFrontier(
    frontier: ChatFrontier,
    own: MemberNumber,
    authoredSequences: number,
): ChatFrontier {
    if (authoredSequences <= 0) return frontier;
    const authored = authoredSequences - 1;
    return frontier.map((entry) =>
        entry.author === own && entry.highest < 0 ? { ...entry, contiguous: authored, highest: authored } : entry,
    );
}

export function missingForPeer(
    peer: ChatFrontier,
    own: ChatFrontier,
): ReadonlyArray<ChatFrontierRange & { author: MemberNumber }> {
    const wanted: Array<ChatFrontierRange & { author: MemberNumber }> = [];
    for (const mine of own) {
        const theirs = peer.find((entry) => entry.author === mine.author);
        const highest = mine.highest;
        if (theirs === undefined) {
            if (highest >= 0) wanted.push({ author: mine.author, from: 0, to: highest });
            continue;
        }
        for (const hole of theirs.holes) {
            if (hole.from > highest) continue;
            wanted.push({ author: mine.author, from: hole.from, to: Math.min(hole.to, highest) });
        }
        if (highest > theirs.contiguous) {
            const from = Math.max(theirs.contiguous, lastHoleEnd(theirs), theirs.highest) + 1;
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
        writer.u64(BigInt(entry.highest + 1));
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
        const highest = safeSequence(reader.u64()) - 1;
        if (highest < contiguous) throw new Error(`A ${FRONTIER_LABEL} claims a highest below its contiguous run`);
        const holeCount = reader.u32();
        if (holeCount > MAX_RANGES) throw new Error(`A ${FRONTIER_LABEL} carries too many holes`);
        const holes: Array<ChatFrontierRange> = [];
        let lowest = contiguous;
        for (let hole = 0; hole < holeCount; hole += 1) {
            const from = safeSequence(reader.u64());
            const to = safeSequence(reader.u64());
            if (from <= lowest || to < from) throw new Error(`A ${FRONTIER_LABEL} carries an unordered hole`);
            if (to > highest) throw new Error(`A ${FRONTIER_LABEL} carries a hole above the head it claims`);
            lowest = to;
            holes.push({ from, to });
        }
        frontier.push({ author, contiguous, highest, holes });
    }
    reader.finish();
    return frontier;
}

function safeSequence(value: bigint): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`A ${FRONTIER_LABEL} sequence is out of range`);
    return Number(value);
}
