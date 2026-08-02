import Logo from '../Logo';
import './PermissionOverlay.css';
import React from 'react';

type PermissionOverlayProps = {
    onClick: () => void;
};

const PermissionOverlay: React.FC<PermissionOverlayProps> = ({ onClick }) => (
    <div className='permission-overlay'>
        <Logo
            size={60}
            style={{ color: 'var(--on-brand)' }}
        />
        <div className='permission-overlay__title'>Enable notifications</div>
        <div className='permission-overlay__text'>
            {process.env.EPHEMON_APP_NAME} needs notification permission so it can alert you to incoming messages and
            connection requests while the app is in the background.
        </div>
        <button
            className='permission-overlay__btn'
            onClick={onClick}
        >
            Allow notifications
        </button>
    </div>
);

export default PermissionOverlay;
