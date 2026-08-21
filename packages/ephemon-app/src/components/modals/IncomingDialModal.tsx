import { hashColor, initials, shortKey } from '../../lib/identicon';
import React from 'react';

type IncomingDialModalProps = {
    publicKey: string;
    onAccept: () => void;
    onDecline: () => void;
    onBlock: () => void;
};

const IncomingDialModal: React.FC<IncomingDialModalProps> = ({ publicKey, onAccept, onDecline, onBlock }) => {
    return (
        <div>
            <div className='rename__title'>Incoming connection</div>
            <div className='rename__sub'>Nobody can reach you until you accept.</div>
            <div className='contact-picker__row'>
                <div
                    className='contact-picker__avatar'
                    style={{ background: hashColor(publicKey) }}
                >
                    {initials(undefined, publicKey)}
                </div>
                <div className='contact-picker__name'>{shortKey(publicKey)}</div>
            </div>
            <div className='dial__actions'>
                <button
                    className='rename__save dial__accept'
                    onClick={onAccept}
                >
                    Accept
                </button>
                <button
                    className='rename__cancel dial__decline'
                    onClick={onDecline}
                >
                    Decline once
                </button>
                <button
                    className='rename__cancel dial__block'
                    onClick={onBlock}
                >
                    Decline forever
                </button>
            </div>
        </div>
    );
};

export default React.memo(IncomingDialModal);
