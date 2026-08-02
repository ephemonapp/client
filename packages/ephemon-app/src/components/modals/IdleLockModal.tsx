import React from 'react';

type IdleLockModalProps = {
    remaining: number;
    onStay: () => void;
};

const IdleLockModal: React.FC<IdleLockModalProps> = ({ remaining, onStay }) => (
    <div>
        <div className='idle__title'>Locking this device</div>
        <div className='idle__sub'>
            There has been no activity for a while. {process.env.EPHEMON_APP_NAME} is about to lock and ask for your
            password again.
        </div>
        <div className='idle__timer'>{Math.max(0, Math.ceil(remaining / 1000))}s</div>
        <button
            className='modal-primary'
            autoFocus
            onClick={onStay}
        >
            Cancel
        </button>
    </div>
);

export default React.memo(IdleLockModal);
