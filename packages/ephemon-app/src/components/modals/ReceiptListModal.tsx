import { hashColor, initials } from '../../lib/identicon';
import React from 'react';

export type ReceiptListEntry = {
    publicKey: string;
    display: string;
    state: 'read' | 'received' | 'waiting';
    reaction?: string;
};

const LABELS: Record<ReceiptListEntry['state'], string> = {
    read: 'Read',
    received: 'Received',
    waiting: 'Waiting',
};

type ReceiptListModalProps = {
    entries: ReadonlyArray<ReceiptListEntry>;
};

const ReceiptListModal: React.FC<ReceiptListModalProps> = ({ entries }) => (
    <div className='receipt-list'>
        <div className='rename__title'>Message status</div>
        <div className='rename__sub'>Who has this message, and who has read it.</div>
        <div className='contact-picker__list'>
            {entries.map((entry) => (
                <div
                    key={entry.publicKey}
                    className='contact-picker__row receipt-list__row'
                    data-state={entry.state}
                >
                    <div
                        className='contact-picker__avatar'
                        style={{ background: hashColor(entry.publicKey) }}
                    >
                        {initials(entry.display, entry.publicKey)}
                    </div>
                    <div className='contact-picker__name'>
                        {entry.display}
                        {entry.reaction === undefined ? '' : ` ${entry.reaction}`}
                    </div>
                    <div className={`receipt-list__state receipt-list__state--${entry.state}`}>
                        {LABELS[entry.state]}
                    </div>
                </div>
            ))}
        </div>
    </div>
);

export default React.memo(ReceiptListModal);
