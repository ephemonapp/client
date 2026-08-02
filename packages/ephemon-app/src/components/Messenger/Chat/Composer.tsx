import { SendIcon } from '../../icons';
import React, { useCallback, useMemo, useRef, useState } from 'react';

export type ComposerHandle = {
    focus(): void;
};

type ComposerProps = {
    placeholder: string;
    autoFocus?: boolean;
    onSend: (text: string) => void;
    onTyping: () => void;
    handleRef?: React.RefObject<ComposerHandle | null>;
};

const Composer: React.FC<ComposerProps> = ({ placeholder, autoFocus, onSend, onTyping, handleRef }) => {
    const [value, setValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const send = useCallback(() => {
        const text = value.trim();
        if (!text) return;
        onSend(text);
        setValue('');
    }, [onSend, value]);

    const focus = useCallback(() => inputRef.current?.focus(), []);

    const handle = useMemo<ComposerHandle>(() => ({ focus }), [focus]);
    if (handleRef) handleRef.current = handle;

    return (
        <div className='composer'>
            <input
                ref={inputRef}
                value={value}
                placeholder={placeholder}
                autoFocus={autoFocus}
                onChange={(e) => {
                    setValue(e.target.value);
                    onTyping();
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        send();
                    }
                }}
            />
            <button
                className='composer__send'
                onClick={send}
            >
                <SendIcon />
            </button>
        </div>
    );
};

export default React.memo(Composer);
