export interface ReplyToMessageType<Sender = 'you' | 'peer'> {
    id: number;
    sender: Sender;
    text: string;
}
