import { WarningIcon } from '../../icons';
import React from 'react';

type FailureBannerProps = {
    text: string;
    onRetry: () => void;
};

const ICON_STYLE = { color: 'var(--warn)', flex: 'none' } as const;

const FailureBanner: React.FC<FailureBannerProps> = ({ text, onRetry }) => (
    <div className='connecting connecting--failed'>
        <WarningIcon
            w={14}
            h={14}
            style={ICON_STYLE}
        />
        <span className='connecting__label connecting__label--failed'>{text}</span>
        <button
            className='connecting__retry'
            onClick={onRetry}
        >
            Try again
        </button>
    </div>
);

export default React.memo(FailureBanner);
