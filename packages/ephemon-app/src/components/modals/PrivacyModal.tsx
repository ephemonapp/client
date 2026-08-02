import { ShieldCheckIcon } from '../icons';
import React from 'react';

type PrivacyModalProps = {
    onClose: () => void;
};

const SOURCE_URL = 'https://github.com/ephemonapp/client';

const PrivacyModal: React.FC<PrivacyModalProps> = ({ onClose }) => (
    <div>
        <div className='privacy__head'>
            <ShieldCheckIcon
                w={20}
                h={20}
                sw={1.7}
            />
            <span className='privacy__title'>How {process.env.EPHEMON_APP_NAME} protects you</span>
        </div>
        <div className='privacy__body'>
            <p>
                All data transfers are time-sensitive, signed, and verified by both server and recipient. Private
                messages use end-to-end encryption with a unique key refreshed on each reconnection — never stored or
                shared. Chat history and your private signing key are stored encrypted, protected by your password, and
                never leave your device.
            </p>
            <p>
                No registration or personal data is required. Dual peer-to-peer channels are established for reliability
                and to circumvent regional restrictions, with seamless fallback to relay servers when direct P2P is
                unavailable. The protocol is trustless by design: neither backend nor relay servers nor counterparties
                can compromise your privacy. Private messages are unlinkable — no one can determine sender or recipient,
                and messages carry no identifying marks.
            </p>
            <p>
                The {process.env.EPHEMON_APP_NAME} server only stores your public signing key and, if you consent, your
                push subscription. It relays data without retention or modification, exclusively over HTTPS.
            </p>
            <p>
                <a
                    href={`${process.env.EPHEMON_CLIENT_URL}/docs/protocol.svg?_=${process.env.EPHEMON_BUILD_TIMESTAMP}`}
                    target='_blank'
                    rel='external noopener noreferrer'
                >
                    See full protocol schema for details.
                </a>
            </p>
            <p>
                See{' '}
                <a
                    href={SOURCE_URL}
                    target='_blank'
                    rel='external noopener noreferrer'
                >
                    source code
                </a>{' '}
                and{' '}
                <a
                    href={`${process.env.EPHEMON_CLIENT_URL}/coverage/index.html`}
                    target='_blank'
                    rel='external noopener noreferrer'
                >
                    coverage
                </a>
                .
            </p>
        </div>
        <button
            className='modal-primary'
            style={{ marginTop: 16 }}
            onClick={onClose}
        >
            Close
        </button>
    </div>
);

export default React.memo(PrivacyModal);
