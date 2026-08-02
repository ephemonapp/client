import { SpinnerIcon } from '../../icons';
import React from 'react';

type ConnectingBannerProps = {
    progress: number;
};

const SPINNER_STYLE = { color: 'var(--pri)', flex: 'none' } as const;

const ConnectingBanner: React.FC<ConnectingBannerProps> = ({ progress }) => (
    <div className='connecting'>
        <SpinnerIcon
            w={14}
            h={14}
            sw={2.4}
            style={SPINNER_STYLE}
        />
        <span className='connecting__label'>Connecting {progress}%</span>
        <div className='connecting__track'>
            <div
                className='connecting__fill'
                style={{ width: `${progress}%` }}
            />
        </div>
        <span className='connecting__relay'>relay ready</span>
    </div>
);

export default React.memo(ConnectingBanner);
