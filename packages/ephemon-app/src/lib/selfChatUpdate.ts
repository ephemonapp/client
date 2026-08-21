import { ChatWindowMessageType } from '../types/chatMessageType';
import { ChatOperation, InboundChatEvent } from '../types/chatOperation';
import { ChatEventRecord, ChatMessageRecord, isChatMessageRecord } from '../types/chatRecord';
import { timestampOfRecordId, toSelfChatRecordId } from '../types/eventId';
import { UpdateReplyType, UpdateType } from '../types/updateType';
import { serverTime } from '../utils/functions';

function toWireReply(reply: ChatWindowMessageType['reply_to']): UpdateReplyType | undefined {
    if (reply === undefined || reply.id === undefined) return undefined;
    return {
        id: timestampOfRecordId(reply.id),
        sender: reply.sender === 'you' ? 'peer' : 'you',
        text: reply.text,
    };
}

function toRecordReply(reply: UpdateReplyType | undefined): ChatWindowMessageType['reply_to'] {
    if (reply === undefined) return undefined;
    return {
        id: toSelfChatRecordId(reply.sender, 'message', reply.id),
        sender: reply.sender,
        text: reply.text,
    };
}

function toWireMessage(record: ChatMessageRecord): UpdateType {
    return {
        id: timestampOfRecordId(record.id),
        message: {
            timestamp: record.timestamp,
            text: record.text,
            reply_to: toWireReply(record.reply_to),
        },
    };
}

function toWireReplay(records: ReadonlyArray<ChatEventRecord>): Array<UpdateType> {
    const updates: Array<UpdateType> = [];
    for (const record of records) {
        if (isChatMessageRecord(record)) {
            if (record.sender === 'you') updates.push(toWireMessage(record));
            continue;
        }
        if (record.sender !== 'you') continue;
        const id = timestampOfRecordId(record.target);
        const at = { timestamp: record.timestamp };
        if (record.kind === 'delivered') updates.push({ id, delivered: at });
        if (record.kind === 'seen') updates.push({ id, seen: at });
        if (record.kind === 'reaction') {
            updates.push({
                id,
                reaction: { timestamp: record.timestamp, value: record.value ?? '' },
            });
        }
    }
    return updates;
}

export type AuthoredSelfChatUpdate = {
    update: UpdateType;
    record?: ChatEventRecord;
};

export function toSelfChatUpdate(operation: ChatOperation): AuthoredSelfChatUpdate {
    const at = serverTime();
    switch (operation.kind) {
        case 'typing':
            return { update: { id: at, action: 'typing' } };
        case 'text': {
            const record: ChatMessageRecord = {
                kind: 'message',
                id: toSelfChatRecordId('you', 'message', at),
                sender: 'you',
                timestamp: at,
                text: operation.text,
                reply_to: operation.replyTo,
            };
            return { update: toWireMessage(record), record };
        }
        case 'delivered':
        case 'seen':
        case 'reaction': {
            const target = timestampOfRecordId(operation.target);
            const record: ChatEventRecord = {
                kind: operation.kind,
                id: toSelfChatRecordId('you', operation.kind, at),
                sender: 'you',
                timestamp: at,
                target: operation.target,
                value: operation.kind === 'reaction' ? operation.value : undefined,
            };
            if (operation.kind === 'delivered') return { update: { id: target, delivered: { timestamp: at } }, record };
            if (operation.kind === 'seen') return { update: { id: target, seen: { timestamp: at } }, record };
            return {
                update: {
                    id: target,
                    reaction: { timestamp: at, value: operation.value },
                },
                record,
            };
        }
        case 'sync':
            return { update: { id: at, history: toWireReplay(operation.records) } };
    }
}

export function fromSelfChatUpdate(update: UpdateType): Array<InboundChatEvent> {
    const events: Array<InboundChatEvent> = [];
    if (update.action === 'typing') events.push({ kind: 'typing' });
    if (update.message != null) {
        events.push({
            kind: 'record',
            record: {
                kind: 'message',
                id: toSelfChatRecordId('peer', 'message', update.id),
                sender: 'peer',
                timestamp: update.message.timestamp,
                text: update.message.text,
                reply_to: toRecordReply(update.message.reply_to),
            },
        });
    }
    const authored = toSelfChatRecordId('you', 'message', update.id);
    const receipt = (kind: 'delivered' | 'seen' | 'reaction', timestamp: number, value?: string): void => {
        events.push({
            kind: 'record',
            record: {
                kind,
                id: toSelfChatRecordId('peer', kind, timestamp),
                sender: 'peer',
                timestamp,
                target: authored,
                value,
            },
        });
    };
    if (update.delivered != null) receipt('delivered', update.delivered.timestamp);
    if (update.seen != null) receipt('seen', update.seen.timestamp);
    if (update.reaction != null) receipt('reaction', update.reaction.timestamp, update.reaction.value);
    for (const historical of update.history ?? []) {
        events.push(...fromSelfChatUpdate(historical));
    }
    return events;
}
