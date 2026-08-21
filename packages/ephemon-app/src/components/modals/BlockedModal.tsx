import { hashColor, initials, shortKey } from '../../lib/identicon';
import React, { useCallback, useState } from 'react';

export type BlockedEntry = {
    publicKey: string;
    serverUrl?: string;
};

type BlockedModalProps = {
    entries: ReadonlyArray<BlockedEntry>;
    onUnblock: (publicKey: string) => void;
};

const BlockedModal: React.FC<BlockedModalProps> = ({ entries, onUnblock }) => {
    const [confirming, setConfirming] = useState<string | undefined>();

    const act = useCallback(
        (publicKey: string) => {
            if (confirming !== publicKey) {
                setConfirming(publicKey);
                return;
            }
            setConfirming(undefined);
            onUnblock(publicKey);
        },
        [confirming, onUnblock],
    );

    return (
        <div>
            <div className='rename__title'>Blocked</div>
            <div className='rename__sub'>A blocked contact cannot reach this device at all.</div>
            {entries.length === 0 ? (
                <div className='contact-picker__empty'>Nobody is blocked.</div>
            ) : (
                <div className='contact-picker__list'>
                    {entries.map((entry) => (
                        <div
                            key={entry.publicKey}
                            className='contact-picker__row'
                        >
                            <div
                                className='contact-picker__avatar'
                                style={{ background: hashColor(entry.publicKey) }}
                            >
                                {initials(undefined, entry.publicKey)}
                            </div>
                            <div className='contact-picker__name'>{shortKey(entry.publicKey)}</div>
                            <button
                                className={`blocked__unblock${confirming === entry.publicKey ? ' blocked__unblock--confirm' : ''}`}
                                onClick={() => act(entry.publicKey)}
                            >
                                {confirming === entry.publicKey ? 'Tap again to unblock' : 'Unblock'}
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default React.memo(BlockedModal);
