import { useTheme } from '../../../theme/ThemeProvider';
import Logo from '../../Logo';
import { LockIcon, MoonIcon, QrIcon, SunIcon } from '../../icons';
import BrandNetStatus from './BrandNetStatus';
import React from 'react';

type BrandHeaderProps = {
    onShowMyQr: () => void;
    onLock: () => void;
};

const BrandHeader: React.FC<BrandHeaderProps> = ({ onShowMyQr, onLock }) => {
    const { theme, toggleTheme } = useTheme();

    return (
        <div className='brand'>
            <div className='brand__tile'>
                <Logo
                    size={24}
                    style={{ color: 'var(--on-brand)' }}
                />
            </div>
            <div className='brand__meta'>
                <div className='brand__name'>{process.env.EPHEMON_APP_NAME}</div>
                <BrandNetStatus />
            </div>
            <button
                className='icon-btn'
                title='Show my QR / copy code'
                onClick={onShowMyQr}
            >
                <QrIcon />
            </button>
            <button
                className='icon-btn'
                title='Theme'
                onClick={toggleTheme}
            >
                {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
            </button>
            <button
                className='icon-btn icon-btn--danger'
                title={`Lock ${process.env.EPHEMON_APP_NAME}`}
                onClick={onLock}
            >
                <LockIcon />
            </button>
        </div>
    );
};

export default React.memo(BrandHeader);
