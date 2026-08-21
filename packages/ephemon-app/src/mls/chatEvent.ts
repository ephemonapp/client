import { ChatWindowMessageType } from '../types/chatMessageType';
import { ChatOperation, InboundChatEvent } from '../types/chatOperation';
import { ChatEventRecord, isChatMessageRecord } from '../types/chatRecord';
import { MemberNumber } from '../types/conversation';
import { EventId, isMlsEventId, mlsEventHash, toMlsEventId } from '../types/eventId';
import { ReplyToMessageType } from '../types/replyToMessageType';
import { decodeBase64Url, encodeBase64Url } from '../utils/base64Url';
import {
    ApplicationEvent,
    ApplicationEventReply,
    applicationEventHash,
    decodeApplicationEvent,
    encodeApplicationEvent,
    isDurableApplicationEvent,
} from './applicationEvent';
import { ChatChainState } from './chatChain';
import { ChatInventory, decodeChatInventory, encodeChatInventory } from './chatFrontier';
import { DirectMlsMembership } from './directBootstrapProtocol';
import {
    HybridLogicalTime,
    nextLocalHybridLogicalTime,
    requireAcceptableRemoteHybridLogicalTime,
} from './hybridLogicalClock';

export type AcceptedChatEvent =
    | InboundChatEvent
    | { kind: 'inventory'; inventory: ChatInventory; reply: boolean }
    | { kind: 'profile'; author: MemberNumber; name: string; locator: string; serverUrl?: string };

export type AuthoredChatEvent = {
    bytes: Uint8Array;
    id: EventId;
    chain: ChatChainState;
    record?: ChatEventRecord;
};

function toLocalSender(author: MemberNumber, membership: DirectMlsMembership): 'you' | 'peer' {
    return Number(author) === Number(membership.ownMemberNumber) ? 'you' : 'peer';
}

function toEventReply(
    reply: ReplyToMessageType | undefined,
    membership: DirectMlsMembership,
): ApplicationEventReply | undefined {
    if (reply === undefined) return undefined;
    if (reply.id === undefined || !isMlsEventId(reply.id)) {
        throw new Error('An MLS reply must reference a stored MLS event');
    }
    return {
        targetHash: mlsEventHash(reply.id),
        authorMemberNumber: reply.sender === 'you' ? membership.ownMemberNumber : membership.peerMemberNumber,
        text: reply.text,
    };
}

function toRecordReply(
    reply: ApplicationEventReply | undefined,
    membership: DirectMlsMembership,
): ReplyToMessageType | undefined {
    if (reply === undefined) return undefined;
    return {
        id: toMlsEventId(reply.targetHash),
        sender: toLocalSender(reply.authorMemberNumber, membership),
        text: reply.text,
    };
}

function toApplicationEvent(
    operation: Exclude<ChatOperation, { kind: 'sync' }>,
    chain: ChatChainState,
    membership: DirectMlsMembership,
    time: HybridLogicalTime,
): ApplicationEvent {
    if (operation.kind === 'typing') return { time, body: { kind: 'typing' } };
    const author = membership.ownMemberNumber;
    const position = { sequence: chain.sequence, previous: chain.head };
    switch (operation.kind) {
        case 'text':
            return {
                time,
                author,
                chain: position,
                body: {
                    kind: 'message.created',
                    text: operation.text,
                    reply: toEventReply(operation.replyTo, membership),
                },
            };
        case 'delivered':
            return {
                time,
                author,
                chain: position,
                body: {
                    kind: 'message.delivered',
                    targetHash: requireHash(operation.target),
                },
            };
        case 'seen':
            return {
                time,
                author,
                chain: position,
                body: {
                    kind: 'message.seen',
                    targetHash: requireHash(operation.target),
                },
            };
        case 'reaction':
            return {
                time,
                author,
                chain: position,
                body: {
                    kind: 'reaction.set',
                    targetHash: requireHash(operation.target),
                    value: operation.value,
                },
            };
    }
}

function requireHash(target: EventId): Uint8Array {
    if (!isMlsEventId(target)) throw new Error('An MLS event can only reference another MLS event');
    return mlsEventHash(target);
}

export async function authorChatEvent(
    operation: Exclude<ChatOperation, { kind: 'sync' }>,
    chain: ChatChainState,
    membership: DirectMlsMembership,
    observed: HybridLogicalTime | undefined,
    physicalNow: number,
    epoch?: bigint,
): Promise<AuthoredChatEvent> {
    const time = nextLocalHybridLogicalTime(observed, physicalNow);
    const event = toApplicationEvent(operation, chain, membership, time);
    const bytes = encodeApplicationEvent(event);
    const hash = await applicationEventHash(bytes);
    const id = toMlsEventId(hash);
    if (operation.kind === 'typing') return { bytes, id, chain };
    const next: ChatChainState = { sequence: chain.sequence + 1, head: hash };
    const origin = {
        counter: time.counter,
        author: membership.ownMemberNumber,
        sequence: chain.sequence,
        event: encodeBase64Url(bytes),
        epoch: epoch?.toString(),
    };
    if (operation.kind === 'text') {
        return {
            bytes,
            id,
            chain: next,
            record: {
                kind: 'message',
                id,
                sender: 'you',
                timestamp: time.physical,
                text: operation.text,
                reply_to: operation.replyTo,
                ...origin,
            },
        };
    }
    return {
        bytes,
        id,
        chain: next,
        record: {
            kind: operation.kind,
            id,
            sender: 'you',
            timestamp: time.physical,
            target: operation.target,
            value: operation.kind === 'reaction' ? operation.value : undefined,
            ...origin,
        },
    };
}

export async function authorProfileEvent(
    name: string,
    locator: string,
    serverUrl: string | undefined,
    observed: HybridLogicalTime | undefined,
    physicalNow: number,
): Promise<Uint8Array> {
    return encodeApplicationEvent({
        time: nextLocalHybridLogicalTime(observed, physicalNow),
        body: { kind: 'member.profile', name, locator, serverUrl },
    });
}

export async function authorInventoryEvent(
    inventory: ChatInventory,
    reply: boolean,
    observed: HybridLogicalTime | undefined,
    physicalNow: number,
): Promise<Uint8Array> {
    return encodeApplicationEvent({
        time: nextLocalHybridLogicalTime(observed, physicalNow),
        body: { kind: 'sync.inventory', reply, frontier: encodeChatInventory(inventory) },
    });
}

export async function acceptChatEvent(
    bytes: Uint8Array,
    author: MemberNumber,
    membership: DirectMlsMembership,
    physicalNow: number,
    epoch?: bigint,
): Promise<AcceptedChatEvent> {
    const event = decodeApplicationEvent(bytes);
    requireAcceptableRemoteHybridLogicalTime(event.time, physicalNow);
    const writer = isDurableApplicationEvent(event) ? event.author : author;
    const sender = toLocalSender(writer, membership);
    if (!isDurableApplicationEvent(event)) {
        if (event.body.kind === 'member.profile') {
            return {
                kind: 'profile',
                author,
                name: event.body.name,
                locator: event.body.locator,
                serverUrl: event.body.serverUrl,
            };
        }
        if (event.body.kind === 'sync.inventory') {
            return {
                kind: 'inventory',
                reply: event.body.reply,
                inventory: decodeChatInventory(event.body.frontier),
            };
        }
        return { kind: 'typing' };
    }
    const id = toMlsEventId(await applicationEventHash(bytes));
    const origin = {
        counter: event.time.counter,
        author: writer,
        sequence: event.chain.sequence,
        event: encodeBase64Url(bytes),
        epoch: epoch?.toString(),
    };
    if (event.body.kind === 'message.created') {
        return {
            kind: 'record',
            record: {
                kind: 'message',
                id,
                sender,
                timestamp: event.time.physical,
                text: event.body.text,
                reply_to: toRecordReply(event.body.reply, membership),
                ...origin,
            },
        };
    }
    const kind =
        event.body.kind === 'message.delivered'
            ? 'delivered'
            : event.body.kind === 'message.seen'
              ? 'seen'
              : 'reaction';
    return {
        kind: 'record',
        record: {
            kind,
            id,
            sender,
            timestamp: event.time.physical,
            target: toMlsEventId(event.body.targetHash),
            value: event.body.kind === 'reaction.set' ? event.body.value : undefined,
            ...origin,
        },
    };
}

export function storedChatEventBytes(record: ChatEventRecord): Uint8Array | undefined {
    return record.event === undefined ? undefined : decodeBase64Url(record.event);
}

export function isOwnChatEventRecord(record: ChatEventRecord): boolean {
    return record.sender === 'you' && record.event !== undefined;
}

export { isChatMessageRecord };
