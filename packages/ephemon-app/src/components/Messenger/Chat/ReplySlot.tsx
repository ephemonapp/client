import { ChatStore, useReplyTo } from '../../../lib/chatStore';
import ReplyBar from './ReplyBar';
import React from 'react';

type ReplySlotProps = {
    store: ChatStore;
    onCancel: () => void;
};

const ReplySlot: React.FC<ReplySlotProps> = ({ store, onCancel }) => {
    const replyTo = useReplyTo(store);

    if (!replyTo) return null;
    return (
        <ReplyBar
            text={replyTo.text}
            sender={replyTo.sender}
            onCancel={onCancel}
            onJump={replyTo.scrollToReply}
        />
    );
};

export default React.memo(ReplySlot);
