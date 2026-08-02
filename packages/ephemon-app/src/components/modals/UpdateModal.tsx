import React from 'react';

type UpdateModalProps = {
    onUpdate: () => void;
};

const UpdateModal: React.FC<UpdateModalProps> = ({ onUpdate }) => (
    <div className='update-modal'>
        <div className='update-modal__title'>Update available</div>
        <div className='update-modal__sub'>
            A new version of {process.env.EPHEMON_APP_NAME} is ready. Reload to get the latest — or dismiss and it'll
            apply next time you open the app.
        </div>
        <button
            className='modal-primary'
            onClick={onUpdate}
        >
            Update now
        </button>
    </div>
);

export default React.memo(UpdateModal);
