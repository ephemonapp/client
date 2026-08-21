import { MemberNumber } from './conversation';
import { DeliveredType } from './deliveredType';
import { EventId } from './eventId';
import { MessageType } from './messageType';
import { ReactionType } from './reactionType';
import { SeenType } from './seenType';

export type ChatRecordOrigin = {
    counter?: number;
    epoch?: string;
    author?: MemberNumber;
    sequence?: number;
    event?: string;
};

export type MemberReceipt = { author: MemberNumber; timestamp: number };

export type MemberReaction = { value: string; authors: ReadonlyArray<MemberNumber>; timestamp: number };

export type ChatMessageType<Sender = 'you' | 'peer' | 'date', ReplySender = 'you' | 'peer'> = {
    id: EventId;
    sender: Sender;
    delivered?: DeliveredType;
    seen?: SeenType;
    reaction?: ReactionType;
    deliveredBy?: ReadonlyArray<MemberReceipt>;
    seenBy?: ReadonlyArray<MemberReceipt>;
    reactions?: ReadonlyArray<MemberReaction>;
} & ChatRecordOrigin &
    MessageType<ReplySender>;

export type ChatWindowMessageType = ChatMessageType;
