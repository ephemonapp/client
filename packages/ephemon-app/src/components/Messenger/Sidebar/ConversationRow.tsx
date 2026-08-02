import {
    useActiveConversation,
    useConnectionStatus,
    useConversationOrder,
    useUnreadCount,
} from '../../../lib/connectionStore';
import { displayName, hashColor, initials } from '../../../lib/identicon';
import { connStatus } from '../../../lib/status';
import { fmtTime } from '../../../lib/time';
import React, { useCallback } from 'react';

export type ConversationRowData = {
    id: number;
    publicKey: string;
    name: string | undefined;
};

type ConversationRowProps = {
    conversation: ConversationRowData;
    onSelect: (id: number) => void;
};

const ConversationRow: React.FC<ConversationRowProps> = ({ conversation, onSelect }) => {
    const { state, transport, notice } = useConnectionStatus(conversation.publicKey);
    const unread = useUnreadCount(conversation.publicKey);
    const order = useConversationOrder(conversation.publicKey);
    const active = useActiveConversation() === conversation.id;

    const { text, color } = connStatus(state, transport, notice);
    const select = useCallback(() => onSelect(conversation.id), [onSelect, conversation.id]);

    return (
        <div
            className={`conv-row${active ? ' conv-row--active' : ''}`}
            onClick={select}
        >
            <div className='conv-row__bar' />
            <div
                className='conv-row__avatar'
                style={{ background: hashColor(conversation.publicKey) }}
            >
                {initials(conversation.name, conversation.publicKey)}
            </div>
            <div className='conv-row__main'>
                <div className='conv-row__top'>
                    <span className='conv-row__name'>{displayName(conversation.name, conversation.publicKey)}</span>
                    <span className='conv-row__time'>{fmtTime(order)}</span>
                </div>
                <div className='conv-row__bottom'>
                    <span
                        className='conv-row__status'
                        style={{ color }}
                    >
                        <span
                            className='conv-row__status-dot'
                            style={{ background: color }}
                        />
                        {text}
                    </span>
                    {unread > 0 && <span className='conv-row__unread'>{unread}</span>}
                </div>
            </div>
        </div>
    );
};

export default React.memo(ConversationRow);
