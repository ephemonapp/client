import { MemberNumber, toMemberNumber } from '../types/conversation';
import { MLS_EVENT_HASH_BYTES } from '../types/eventId';
import { Reader, Writer } from './byteCodec';
import { HybridLogicalTime } from './hybridLogicalClock';

export const APPLICATION_EVENT_VERSION = 1;

const EVENT_LABEL = 'MLS application event';

const EVENT_KINDS = {
    'message.created': 1,
    'message.delivered': 2,
    'message.seen': 3,
    'reaction.set': 4,
    'typing': 5,
    'sync.inventory': 6,
    'member.profile': 7,
} as const;

const EPHEMERAL_KINDS: ReadonlyArray<keyof typeof EVENT_KINDS> = ['typing', 'sync.inventory', 'member.profile'];

const REPLY_ABSENT = 0;
const REPLY_PRESENT = 1;

export type ApplicationEventReply = {
    targetHash: Uint8Array;
    authorMemberNumber: MemberNumber;
    text: string;
};

export type DurableApplicationEventBody =
    | { kind: 'message.created'; text: string; reply?: ApplicationEventReply }
    | { kind: 'message.delivered'; targetHash: Uint8Array }
    | { kind: 'message.seen'; targetHash: Uint8Array }
    | { kind: 'reaction.set'; targetHash: Uint8Array; value: string };

export type EphemeralApplicationEventBody =
    | { kind: 'typing' }
    | { kind: 'sync.inventory'; frontier: Uint8Array; reply: boolean }
    | { kind: 'member.profile'; name: string; locator: string; serverUrl?: string };

export type ApplicationEventBody = DurableApplicationEventBody | EphemeralApplicationEventBody;

export type ApplicationEventChain = {
    sequence: number;
    previous?: Uint8Array;
};

export type DurableApplicationEvent = {
    time: HybridLogicalTime;
    author: MemberNumber;
    chain: ApplicationEventChain;
    body: DurableApplicationEventBody;
};

export type EphemeralApplicationEvent = {
    time: HybridLogicalTime;
    body: EphemeralApplicationEventBody;
};

export type ApplicationEvent = DurableApplicationEvent | EphemeralApplicationEvent;

export function isDurableApplicationEvent(event: ApplicationEvent): event is DurableApplicationEvent {
    return !EPHEMERAL_KINDS.includes(event.body.kind);
}

function encodeBody(writer: Writer, body: ApplicationEventBody): void {
    switch (body.kind) {
        case 'message.created':
            writer.variable(new TextEncoder().encode(body.text));
            if (body.reply === undefined) {
                writer.u8(REPLY_ABSENT);
                break;
            }
            writer.u8(REPLY_PRESENT);
            writer.fixed(body.reply.targetHash, MLS_EVENT_HASH_BYTES, 'Reply target hash');
            writer.u32(body.reply.authorMemberNumber);
            writer.variable(new TextEncoder().encode(body.reply.text));
            break;
        case 'message.delivered':
        case 'message.seen':
            writer.fixed(body.targetHash, MLS_EVENT_HASH_BYTES, 'Receipt target hash');
            break;
        case 'member.profile':
            writer.variable(new TextEncoder().encode(body.name));
            writer.variable(new TextEncoder().encode(body.locator));
            writer.variable(new TextEncoder().encode(body.serverUrl ?? ''));
            break;
        case 'reaction.set':
            writer.fixed(body.targetHash, MLS_EVENT_HASH_BYTES, 'Reaction target hash');
            writer.variable(new TextEncoder().encode(body.value));
            break;
        case 'typing':
            break;
        case 'sync.inventory':
            writer.u8(body.reply ? 1 : 0);
            writer.variable(body.frontier);
            break;
    }
}

export function encodeApplicationEvent(event: ApplicationEvent): Uint8Array {
    const writer = new Writer();
    writer.u8(APPLICATION_EVENT_VERSION);
    writer.u8(EVENT_KINDS[event.body.kind]);
    writer.u64(BigInt(event.time.physical));
    writer.u32(event.time.counter);
    if (isDurableApplicationEvent(event)) {
        writer.u32(Number(event.author));
        if (!Number.isSafeInteger(event.chain.sequence) || event.chain.sequence < 0) {
            throw new Error('An event sequence must be a non-negative safe integer');
        }
        if (event.chain.previous === undefined && event.chain.sequence !== 0) {
            throw new Error('Only the first event of a chain may omit its predecessor');
        }
        writer.u64(BigInt(event.chain.sequence));
        writer.u8(event.chain.previous === undefined ? 0 : 1);
        if (event.chain.previous !== undefined) {
            writer.fixed(event.chain.previous, MLS_EVENT_HASH_BYTES, 'Previous event hash');
        }
    }
    const body = new Writer();
    encodeBody(body, event.body);
    writer.variable(body.finish());
    return writer.finish();
}

function decodeText(bytes: Uint8Array): string {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function decodeBody(reader: Reader, kind: keyof typeof EVENT_KINDS): ApplicationEventBody {
    switch (kind) {
        case 'message.created': {
            const text = decodeText(reader.variable());
            const presence = reader.u8();
            if (presence === REPLY_ABSENT) return { kind: 'message.created', text };
            if (presence !== REPLY_PRESENT) {
                throw new Error(`Unknown reply presence ${presence} in an ${EVENT_LABEL}`);
            }
            const targetHash = reader.fixed(MLS_EVENT_HASH_BYTES);
            const authorMemberNumber = toMemberNumber(reader.u32());
            return {
                kind: 'message.created',
                text,
                reply: { targetHash, authorMemberNumber, text: decodeText(reader.variable()) },
            };
        }
        case 'message.delivered':
            return { kind: 'message.delivered', targetHash: reader.fixed(MLS_EVENT_HASH_BYTES) };
        case 'message.seen':
            return { kind: 'message.seen', targetHash: reader.fixed(MLS_EVENT_HASH_BYTES) };
        case 'reaction.set':
            return {
                kind: 'reaction.set',
                targetHash: reader.fixed(MLS_EVENT_HASH_BYTES),
                value: decodeText(reader.variable()),
            };
        case 'member.profile': {
            const name = decodeText(reader.variable());
            const locator = decodeText(reader.variable());
            const serverUrl = decodeText(reader.variable());
            return { kind: 'member.profile', name, locator, serverUrl: serverUrl.length > 0 ? serverUrl : undefined };
        }
        case 'typing':
            return { kind: 'typing' };
        case 'sync.inventory': {
            const reply = reader.u8();
            if (reply !== 0 && reply !== 1) throw new Error(`Unknown inventory reply flag in an ${EVENT_LABEL}`);
            return { kind: 'sync.inventory', reply: reply === 1, frontier: reader.variable() };
        }
    }
}

function kindOf(value: number): keyof typeof EVENT_KINDS {
    for (const [kind, encoded] of Object.entries(EVENT_KINDS)) {
        if (encoded === value) return kind as keyof typeof EVENT_KINDS;
    }
    throw new Error(`Unknown ${EVENT_LABEL} kind ${value}`);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

export function decodeApplicationEvent(bytes: Uint8Array): ApplicationEvent {
    const reader = new Reader(bytes, EVENT_LABEL);
    const version = reader.u8();
    if (version !== APPLICATION_EVENT_VERSION) throw new Error(`Unsupported ${EVENT_LABEL} version ${version}`);
    const kind = kindOf(reader.u8());
    const physical = reader.u64();
    if (physical > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`An ${EVENT_LABEL} time is out of range`);
    const time: HybridLogicalTime = { physical: Number(physical), counter: reader.u32() };

    let chain: ApplicationEventChain | undefined;
    let author: MemberNumber | undefined;
    if (!EPHEMERAL_KINDS.includes(kind)) {
        author = toMemberNumber(reader.u32());
        const sequence = reader.u64();
        if (sequence > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`An ${EVENT_LABEL} sequence is out of range`);
        const presence = reader.u8();
        if (presence !== 0 && presence !== 1) {
            throw new Error(`Unknown predecessor presence ${presence} in an ${EVENT_LABEL}`);
        }
        chain = {
            sequence: Number(sequence),
            previous: presence === 1 ? reader.fixed(MLS_EVENT_HASH_BYTES) : undefined,
        };
        if (chain.previous === undefined && chain.sequence !== 0) {
            throw new Error('Only the first event of a chain may omit its predecessor');
        }
    }

    const bodyReader = new Reader(reader.variable(), EVENT_LABEL);
    const body = decodeBody(bodyReader, kind);
    bodyReader.finish();
    reader.finish();

    let event: ApplicationEvent;
    if (body.kind === 'typing' || body.kind === 'sync.inventory' || body.kind === 'member.profile') {
        event = { time, body };
    } else {
        if (chain === undefined || author === undefined) {
            throw new Error(`A durable ${EVENT_LABEL} must carry its author and its chain position`);
        }
        event = { time, author, chain, body };
    }
    if (!sameBytes(encodeApplicationEvent(event), bytes)) {
        throw new Error(`An ${EVENT_LABEL} is not canonically encoded`);
    }
    return event;
}

export async function applicationEventHash(bytes: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
}
