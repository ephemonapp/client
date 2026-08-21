import { EventId } from '../../../types/eventId';
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
    msgId: EventId;
    x: number;
    y: number;
    origin: string;
};

type ReactionPickerProps = {
    anchor: ReactionAnchor;
    onPick: (emoji: string) => void;
    chosen?: string;
    onClose: () => void;
};

const ReactionPicker: React.FC<ReactionPickerProps> = ({ anchor, onPick, onClose, chosen }) => (
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
                    className={emoji === chosen ? 'reaction-picker__chosen' : undefined}
                    onClick={() => onPick(emoji)}
                >
                    {emoji}
                </button>
            ))}
        </div>
    </div>
);

export default React.memo(ReactionPicker);
