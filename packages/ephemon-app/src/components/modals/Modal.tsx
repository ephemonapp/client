import { CloseIcon } from '../icons';
import './modals.css';
import React from 'react';

type ModalProps = {
    onClose: () => void;
    children: React.ReactNode;
};

const Modal: React.FC<ModalProps> = ({ onClose, children }) => (
    <div
        className='modal-backdrop'
        onClick={onClose}
    >
        <div
            className='modal-card'
            onClick={(e) => e.stopPropagation()}
        >
            <button
                className='modal-close'
                title='Close'
                onClick={onClose}
            >
                <CloseIcon />
            </button>
            {children}
        </div>
    </div>
);

export default React.memo(Modal);
