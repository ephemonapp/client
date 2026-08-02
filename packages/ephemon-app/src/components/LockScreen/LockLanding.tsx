import Logo from '../Logo';
import { LockIcon, P2PIcon, PulseIcon, UsersIcon } from '../icons';
import React from 'react';

const LockLanding: React.FC = () => (
    <div className='lock__landing'>
        <div className='lock__brand'>
            <Logo
                size={56}
                style={{ color: 'var(--pri-text)' }}
            />
            <span className='lock__wordmark'>{process.env.EPHEMON_APP_NAME}</span>
        </div>
        <div className='lock__center'>
            <h2 className='lock__headline'>Private messaging that leaves no trace.</h2>
            <p className='lock__sub'>
                Peer-to-peer, end-to-end encrypted, and unlinkable by design. Your keys and history stay on your device.
            </p>
            <div className='lock__features'>
                <div className='lock__feature'>
                    <LockIcon
                        w={26}
                        h={26}
                        sw={1.6}
                        style={{ color: 'var(--pri-text)' }}
                    />
                    <div>
                        <div className='lock__feature-title'>End-to-end encrypted</div>
                        <div className='lock__feature-desc'>
                            A fresh key on every reconnection — never stored, never shared.
                        </div>
                    </div>
                </div>
                <div className='lock__feature'>
                    <UsersIcon style={{ color: 'var(--pri-text)' }} />
                    <div>
                        <div className='lock__feature-title'>No accounts, no personal data</div>
                        <div className='lock__feature-desc'>No phone number, no email, no registration.</div>
                    </div>
                </div>
                <div className='lock__feature'>
                    <P2PIcon style={{ color: 'var(--pri-text)' }} />
                    <div>
                        <div className='lock__feature-title'>Direct P2P, automatic relay fallback</div>
                        <div className='lock__feature-desc'>
                            Two channels for reliability and to bypass restrictions.
                        </div>
                    </div>
                </div>
                <div className='lock__feature'>
                    <PulseIcon style={{ color: 'var(--pri-text)' }} />
                    <div>
                        <div className='lock__feature-title'>Unlinkable</div>
                        <div className='lock__feature-desc'>No sender, no recipient, no identifying marks.</div>
                    </div>
                </div>
            </div>
        </div>
        <div className='lock__landing-footer'>open source · audited coverage</div>
    </div>
);

export default React.memo(LockLanding);
