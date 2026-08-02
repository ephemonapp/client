import { ReplyToMessageType } from './replyToMessageType';

export interface MessageType {
    timestamp: number;
    text: string;
    reply_to?: ReplyToMessageType;
}
