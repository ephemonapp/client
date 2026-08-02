import { DeliveredType } from './deliveredType';
import { MessageType } from './messageType';
import { ReactionType } from './reactionType';
import { SeenType } from './seenType';

export type ChatMessageType = {
    id: number;
    sender: 'you' | 'peer' | 'date';
    delivered?: DeliveredType;
    seen?: SeenType;
    reaction?: ReactionType;
} & MessageType;

export type ChatWindowMessageType = ChatMessageType;
