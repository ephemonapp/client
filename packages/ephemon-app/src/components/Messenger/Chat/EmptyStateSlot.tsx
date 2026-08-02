import { useActiveConversation } from '../../../lib/connectionStore';
import EmptyState from './EmptyState';
import React from 'react';

type EmptyStateSlotProps = {
    ids: ReadonlyArray<number>;
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
