import { useConnectionNotice, useConnectionProgress, useConnectionStatus } from '../../../lib/connectionStore';
import { noticeText } from '../../../lib/notice';
import ConnectingBanner from './ConnectingBanner';
import FailureBanner from './FailureBanner';
import React from 'react';

type ConnectingSlotProps = {
    publicKey: string;
    name: string;
    onRetry: () => void;
};

const ConnectingSlot: React.FC<ConnectingSlotProps> = ({ publicKey, name, onRetry }) => {
    const { state } = useConnectionStatus(publicKey);
    const notice = useConnectionNotice(publicKey);
    const progress = useConnectionProgress(publicKey);

    if (notice !== undefined && state !== 'open' && state !== 'degraded') {
        return (
            <FailureBanner
                text={noticeText(notice, name)}
                onRetry={onRetry}
            />
        );
    }
    if (state !== 'connecting') return null;
    return <ConnectingBanner progress={progress || 5} />;
};

export default React.memo(ConnectingSlot);
