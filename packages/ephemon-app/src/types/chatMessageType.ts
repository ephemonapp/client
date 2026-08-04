import { MemberNumber } from './conversation';
import { DeliveredType } from './deliveredType';
import { MessageType } from './messageType';
import { ReactionType } from './reactionType';
import { SeenType } from './seenType';

export type ChatMessageType<Sender = 'you' | 'peer' | 'date', ReplySender = 'you' | 'peer'> = {
    id: number;
    sender: Sender;
    delivered?: DeliveredType;
    seen?: SeenType;
    reaction?: ReactionType;
} & MessageType<ReplySender>;

export type ChatWindowMessageType = ChatMessageType;
export type AuthenticatedChatMessageType = {
    id: number;
    sender: MemberNumber;
} & MessageType<MemberNumber>;
