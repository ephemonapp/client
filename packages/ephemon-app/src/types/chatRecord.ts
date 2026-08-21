import { ChatRecordOrigin, ChatWindowMessageType } from './chatMessageType';
import { EventId } from './eventId';

export type ChatMessageRecord = { kind: 'message' } & Omit<ChatWindowMessageType, 'delivered' | 'seen' | 'reaction'>;

export type ChatReceiptRecord = {
    kind: 'delivered' | 'seen' | 'reaction';
    id: EventId;
    sender: 'you' | 'peer';
    timestamp: number;
    target: EventId;
    value?: string;
} & ChatRecordOrigin;

export type ChatEventRecord = ChatMessageRecord | ChatReceiptRecord;

export function isChatMessageRecord(record: ChatEventRecord): record is ChatMessageRecord {
    return record.kind === 'message';
}
