import { ChatEventRecord } from './chatRecord';
import { EventId } from './eventId';
import { ReplyToMessageType } from './replyToMessageType';

export type ChatOperation =
    | { kind: 'typing' }
    | { kind: 'text'; text: string; replyTo?: ReplyToMessageType }
    | { kind: 'delivered'; target: EventId }
    | { kind: 'seen'; target: EventId }
    | { kind: 'reaction'; target: EventId; value: string }
    | { kind: 'sync'; records: ReadonlyArray<ChatEventRecord> };

export type InboundChatEvent = { kind: 'typing' } | { kind: 'record'; record: ChatEventRecord };
