import { ScanIcon } from '../icons';
import React, { useCallback, useState } from 'react';

type ConnectModalProps = {
    onConnect: (code: string) => void;
    onScan: () => void;
};

const ConnectModal: React.FC<ConnectModalProps> = ({ onConnect, onScan }) => {
    const [value, setValue] = useState('');

    const connect = useCallback(() => {
        if (value.trim()) onConnect(value);
    }, [onConnect, value]);

    return (
        <div className='connect-modal'>
            <div className='connect-modal__title'>New chat</div>
            <div className='connect-modal__sub'>
                Scan a contact's code or paste it to start a private, encrypted conversation.
            </div>
            <button
                className='connect-modal__scan'
                onClick={onScan}
            >
                <ScanIcon />
                Scan a contact's code
            </button>
            <div className='connect-modal__or'>
                <span>or</span>
            </div>
            <div className='connect-modal__paste'>
                <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            connect();
                        }
                    }}
                    placeholder="Paste a contact's code…"
                />
                <button
                    className='connect-modal__connect'
                    onClick={connect}
                >
                    Connect
                </button>
            </div>
        </div>
    );
};

export default React.memo(ConnectModal);
