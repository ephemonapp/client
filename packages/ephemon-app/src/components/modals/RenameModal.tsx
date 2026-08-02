import React, { useState } from 'react';

type RenameModalProps = {
    current: string;
    onCancel: () => void;
    onSave: (name: string) => void;
};

const RenameModal: React.FC<RenameModalProps> = ({ current, onCancel, onSave }) => {
    const [value, setValue] = useState(current);

    const save = () => onSave(value.trim());

    return (
        <div>
            <div className='rename__title'>Rename contact</div>
            <div className='rename__sub'>Only changes the label on your device — it never leaves it.</div>
            <input
                className='rename__input'
                value={value}
                autoFocus
                placeholder='Contact name'
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        save();
                    }
                }}
            />
            <div className='rename__actions'>
                <button
                    className='rename__cancel'
                    onClick={onCancel}
                >
                    Cancel
                </button>
                <button
                    className='rename__save'
                    onClick={save}
                >
                    Save
                </button>
            </div>
        </div>
    );
};

export default React.memo(RenameModal);
