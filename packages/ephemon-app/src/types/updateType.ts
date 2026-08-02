import { ActionType } from './actionType';
import { DeliveredType } from './deliveredType';
import { MessageType } from './messageType';
import { ReactionType } from './reactionType';
import { SeenType } from './seenType';

export interface UpdateType {
    id: number;
    action?: ActionType;
    message?: MessageType;
    delivered?: DeliveredType;
    seen?: SeenType;
    reaction?: ReactionType;
    history?: UpdateType[];
}
