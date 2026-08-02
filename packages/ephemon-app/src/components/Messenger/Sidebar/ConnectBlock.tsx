import { ArrowRightIcon, ScanIcon } from '../../icons';
import React, { useCallback, useState } from 'react';

type ConnectBlockProps = {
    visible: boolean;
    isMobile: boolean;
    onConnect: (code: string) => void;
    onScan: () => void;
};

const ConnectBlock: React.FC<ConnectBlockProps> = ({ visible, isMobile, onConnect, onScan }) => {
    const [value, setValue] = useState('');

    const connect = useCallback(() => {
        if (!value.trim()) return;
        onConnect(value);
        setValue('');
    }, [onConnect, value]);

    if (!visible) return null;

    return (
        <div className={`connect${isMobile ? ' connect--mobile' : ''}`}>
            <button
                className='connect__scan'
                onClick={onScan}
            >
                <ScanIcon />
                Scan a contact's code
            </button>
            <div className='connect__paste'>
                <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            connect();
                        }
                    }}
                    placeholder='or paste it here…'
                />
                <button
                    className='icon-btn'
                    title='Connect'
                    onClick={connect}
                >
                    <ArrowRightIcon />
                </button>
            </div>
        </div>
    );
};

export default React.memo(ConnectBlock);
