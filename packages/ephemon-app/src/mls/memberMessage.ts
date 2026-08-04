import { AuthenticatedChatMessageType, ChatWindowMessageType } from '../types/chatMessageType';
import { MemberNumber } from '../types/conversation';

function toDirectWindowSender(
    sender: MemberNumber,
    ownMemberNumber: MemberNumber,
    peerMemberNumber: MemberNumber,
): 'you' | 'peer' {
    if (sender === ownMemberNumber) return 'you';
    if (sender === peerMemberNumber) return 'peer';
    throw new Error('MLS sender is not a member of this direct conversation');
}

export function toDirectChatWindowMessage(
    message: AuthenticatedChatMessageType,
    ownMemberNumber: MemberNumber,
    peerMemberNumber: MemberNumber,
): ChatWindowMessageType {
    return {
        ...message,
        sender: toDirectWindowSender(message.sender, ownMemberNumber, peerMemberNumber),
        reply_to:
            message.reply_to === undefined
                ? undefined
                : {
                      ...message.reply_to,
                      sender: toDirectWindowSender(message.reply_to.sender, ownMemberNumber, peerMemberNumber),
                  },
    };
}

export function toAuthenticatedDirectChatMessage(
    message: ChatWindowMessageType,
    ownMemberNumber: MemberNumber,
    peerMemberNumber: MemberNumber,
): AuthenticatedChatMessageType {
    if (message.sender === 'date') throw new Error('Date separators are UI-only and cannot become MLS messages');
    const memberNumber = (sender: 'you' | 'peer'): MemberNumber =>
        sender === 'you' ? ownMemberNumber : peerMemberNumber;
    return {
        id: message.id,
        sender: memberNumber(message.sender),
        timestamp: message.timestamp,
        text: message.text,
        reply_to:
            message.reply_to === undefined
                ? undefined
                : {
                      ...message.reply_to,
                      sender: memberNumber(message.reply_to.sender),
                  },
    };
}
