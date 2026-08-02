import { getConversationOrder, useConversationOrderRevision } from '../../../lib/connectionStore';
import ConversationRow, { ConversationRowData } from './ConversationRow';
import React, { useMemo } from 'react';

type ConversationListProps = {
    conversations: Array<ConversationRowData>;
    onSelect: (id: number) => void;
};

const ConversationList: React.FC<ConversationListProps> = ({ conversations, onSelect }) => {
    const revision = useConversationOrderRevision();
    const sorted = useMemo(
        () => [...conversations].sort((a, b) => getConversationOrder(b.publicKey) - getConversationOrder(a.publicKey)),
        [conversations, revision],
    );

    return (
        <div className='conv-list'>
            {sorted.map((conversation) => (
                <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    onSelect={onSelect}
                />
            ))}
        </div>
    );
};

export default React.memo(ConversationList);
