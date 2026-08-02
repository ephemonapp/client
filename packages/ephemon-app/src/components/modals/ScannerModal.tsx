import Optional, { optionalModule } from '../Optional';
import React, { useState } from 'react';

type ScannerModalProps = {
    onConnect: (code: string) => void;
};

const scannerView = optionalModule(() => import(/* webpackChunkName: "scanner.min" */ './ScannerView'));

const LOADING = <div className='scanner__video skeleton skeleton--dark' />;
const FAILED = <div className='scanner__video' />;

const ScannerModal: React.FC<ScannerModalProps> = ({ onConnect }) => {
    const [value, setValue] = useState('');

    return (
        <div className='scanner'>
            <div className='scanner__title'>Scan a contact's code</div>
            <div className='scanner__view'>
                <Optional
                    module={scannerView}
                    fallback={LOADING}
                    failure={FAILED}
                >
                    {(ScannerView) => <ScannerView onResult={onConnect} />}
                </Optional>
                <div className='scanner__corner scanner__corner--tl' />
                <div className='scanner__corner scanner__corner--tr' />
                <div className='scanner__corner scanner__corner--bl' />
                <div className='scanner__corner scanner__corner--br' />
            </div>
            <div className='scanner__help'>
                Point your camera at a contact's {process.env.EPHEMON_APP_NAME} code. Camera access is requested on the
                live device.
            </div>
            <div className='scanner__paste'>
                <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder='or paste it here'
                />
                <button
                    className='scanner__connect'
                    onClick={() => value.trim() && onConnect(value.trim())}
                >
                    Connect
                </button>
            </div>
        </div>
    );
};

export default React.memo(ScannerModal);
