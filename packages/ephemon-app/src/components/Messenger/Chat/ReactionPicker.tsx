import React from 'react';

export const REACTION_EMOJIS = [
    '❤️',
    '👍',
    '😂',
    '😮',
    '😢',
    '🙏',
    '💜',
    '🔥',
    '👏',
    '😍',
    '🎉',
    '😱',
    '👎',
    '💯',
    '🤔',
];

export type ReactionAnchor = {
    msgId: number;
    x: number;
    y: number;
    origin: string;
};

type ReactionPickerProps = {
    anchor: ReactionAnchor;
    onPick: (emoji: string) => void;
    onClose: () => void;
};

const ReactionPicker: React.FC<ReactionPickerProps> = ({ anchor, onPick, onClose }) => (
    <div
        className='reaction-picker-overlay'
        onClick={onClose}
    >
        <div
            className='reaction-picker'
            onClick={(e) => e.stopPropagation()}
            style={{ left: anchor.x, top: anchor.y, transformOrigin: anchor.origin }}
        >
            {REACTION_EMOJIS.map((emoji) => (
                <button
                    key={emoji}
                    onClick={() => onPick(emoji)}
                >
                    {emoji}
                </button>
            ))}
        </div>
    </div>
);

export default React.memo(ReactionPicker);
