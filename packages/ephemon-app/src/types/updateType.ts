import { ActionType } from './actionType';
import { DeliveredType } from './deliveredType';
import { ReactionType } from './reactionType';
import { SeenType } from './seenType';

export interface UpdateReplyType {
    id: number;
    sender: 'you' | 'peer';
    text: string;
}

export interface UpdateMessageType {
    timestamp: number;
    text: string;
    reply_to?: UpdateReplyType;
}

export interface UpdateType {
    id: number;
    action?: ActionType;
    message?: UpdateMessageType;
    delivered?: DeliveredType;
    seen?: SeenType;
    reaction?: ReactionType;
    history?: UpdateType[];
}
