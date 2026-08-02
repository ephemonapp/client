import { ChatWindowMessageType } from '../types/chatMessageType';
import { ReplyToMessageType } from '../types/replyToMessageType';
import { UpdateType } from '../types/updateType';

export function flipReplyTo(replyTo: ReplyToMessageType | undefined): ReplyToMessageType | undefined {
    if (replyTo === undefined) return undefined;
    return { id: replyTo.id, sender: replyTo.sender === 'you' ? 'peer' : 'you', text: replyTo.text };
}

export function buildReplay(messages: ReadonlyArray<ChatWindowMessageType>): Array<UpdateType> {
    const updates: Array<UpdateType> = [];
    for (const message of messages) {
        if (message.sender === 'you') {
            updates.push({
                id: message.id,
                message: {
                    timestamp: message.timestamp,
                    text: message.text,
                    reply_to: flipReplyTo(message.reply_to),
                },
            });
            continue;
        }
        if (message.sender !== 'peer') continue;
        if (message.delivered === undefined && message.seen === undefined && message.reaction === undefined) {
            continue;
        }
        updates.push({
            id: message.id,
            delivered: message.delivered,
            seen: message.seen,
            reaction: message.reaction,
        });
    }
    return updates;
}
