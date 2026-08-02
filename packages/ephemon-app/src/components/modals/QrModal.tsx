import Optional, { optionalModule } from '../Optional';
import React, { useState } from 'react';

type QrModalProps = {
    title: string;
    subtitle: string;
    keyText: string;
};

const qrCode = optionalModule(() => import(/* webpackChunkName: "qrcode.min" */ './QrCode'));

function copyText(text: string) {
    try {
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
            return;
        }
    } catch {}
    fallbackCopy(text);
}

function fallbackCopy(text: string) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    } catch {}
}

const LOADING = <div className='qr__box qr__box--placeholder skeleton' />;
const FAILED = <div className='qr__box qr__box--placeholder' />;

const QrModal: React.FC<QrModalProps> = ({ title, subtitle, keyText }) => {
    const [copied, setCopied] = useState(false);

    const onCopy = () => {
        copyText(keyText);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
    };

    return (
        <div className='qr'>
            <div className='qr__title'>{title}</div>
            <div className='qr__sub'>{subtitle}</div>
            <Optional
                module={qrCode}
                fallback={LOADING}
                failure={FAILED}
            >
                {(QrCode) => (
                    <div className='qr__box'>
                        <QrCode value={keyText} />
                    </div>
                )}
            </Optional>
            <div className='qr__key'>{keyText}</div>
            <button
                className='modal-primary'
                onClick={onCopy}
            >
                {copied ? 'Copied ✓' : 'Copy code'}
            </button>
        </div>
    );
};

export default React.memo(QrModal);
