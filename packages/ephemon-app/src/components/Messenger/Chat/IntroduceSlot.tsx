import React, { useCallback, useState } from 'react';

type IntroduceSlotProps = {
    groupName: string;
    onIntroduce: (name: string) => void;
};

const IntroduceSlot: React.FC<IntroduceSlotProps> = ({ groupName, onIntroduce }) => {
    const [value, setValue] = useState('');
    const trimmed = value.trim();

    const introduce = useCallback(() => {
        if (trimmed.length === 0) return;
        onIntroduce(trimmed);
    }, [onIntroduce, trimmed]);

    return (
        <div className='introduce'>
            <div className='introduce__card'>
                <div className='introduce__title'>Introduce yourself</div>
                <div className='introduce__sub'>
                    {groupName} sees this name on everything you send. Until you pick one the conversation stays closed,
                    and nothing goes out under your name — not even a read receipt.
                </div>
                <input
                    className='introduce__input'
                    value={value}
                    autoFocus
                    placeholder='Your name in this group'
                    onChange={(event) => setValue(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            introduce();
                        }
                    }}
                />
                <button
                    className='introduce__save'
                    disabled={trimmed.length === 0}
                    onClick={introduce}
                >
                    Join the conversation
                </button>
            </div>
        </div>
    );
};

export default React.memo(IntroduceSlot);
