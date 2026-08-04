import { useActiveConversation } from '../../../lib/connectionStore';
import { ConversationId } from '../../../types/conversation';
import EmptyState from './EmptyState';
import React from 'react';

type EmptyStateSlotProps = {
    ids: ReadonlyArray<ConversationId>;
};

const EmptyStateSlot: React.FC<EmptyStateSlotProps> = ({ ids }) => {
    const activeId = useActiveConversation();

    if (activeId !== undefined && ids.includes(activeId)) return null;
    return (
        <div className='chat'>
            <EmptyState />
        </div>
    );
};

export default React.memo(EmptyStateSlot);
