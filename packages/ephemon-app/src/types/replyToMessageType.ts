import { EventId } from './eventId';

export interface ReplyToMessageType<Sender = 'you' | 'peer'> {
    id?: EventId;
    sender: Sender;
    text: string;
}
