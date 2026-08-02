import React, { useCallback } from 'react';

type ReplyBarProps = {
    text: string;
    sender: 'you' | 'peer';
    onCancel: () => void;
    onJump: () => void;
};

const ReplyBar: React.FC<ReplyBarProps> = ({ text, sender, onCancel, onJump }) => {
    const cancel = useCallback(
        (event: React.MouseEvent) => {
            event.stopPropagation();
            onCancel();
        },
        [onCancel],
    );

    return (
        <div
            className={`reply-bar reply-bar--${sender}`}
            onClick={onJump}
        >
            <span className='reply-bar__label'>Reply to {sender === 'you' ? 'you' : 'them'}</span>
            <span className='reply-bar__text'>{text}</span>
            <span
                className='reply-bar__close'
                onClick={cancel}
            >
                ×
            </span>
        </div>
    );
};

export default React.memo(ReplyBar);
