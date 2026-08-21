import { ReplyToMessageType } from './replyToMessageType';

export interface MessageType<ReplySender = 'you' | 'peer'> {
    timestamp: number;
    text: string;
    reply_to?: ReplyToMessageType<ReplySender>;
}
