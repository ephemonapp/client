import Logo from '../../Logo';
import React from 'react';

const EmptyState: React.FC = () => (
    <div className='empty'>
        <Logo
            size={72}
            style={{ color: 'var(--pri-text)', opacity: 0.5 }}
        />
        <div className='empty__title'>No chat selected</div>
        <div className='empty__sub'>Scan a contact's code or paste it to start a private, encrypted conversation.</div>
    </div>
);

export default React.memo(EmptyState);
