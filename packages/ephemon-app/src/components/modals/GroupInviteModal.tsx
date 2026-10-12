import { hashColor, initials } from '../../lib/identicon';
import React from 'react';

type GroupInviteModalProps = {
    inviterPublicKey: string;
    inviterName: string;
    groupName: string;
    onAccept: () => void;
    onDecline: () => void;
    onBlock: () => void;
};

const GroupInviteModal: React.FC<GroupInviteModalProps> = ({
    inviterPublicKey,
    inviterName,
    groupName,
    onAccept,
    onDecline,
    onBlock,
}) => {
    return (
        <div>
            <div className='rename__title'>Group invitation</div>
            <div className='rename__sub'>
                {inviterName} invites you to {groupName}. Nothing appears in your chats until you accept.
            </div>
            <div className='contact-picker__row'>
                <div
                    className='contact-picker__avatar'
                    style={{ background: hashColor(inviterPublicKey) }}
                >
                    {initials(inviterName, inviterPublicKey)}
                </div>
                <div className='contact-picker__name'>{inviterName}</div>
            </div>
            <div className='dial__actions'>
                <button
                    className='rename__save invite__accept'
                    onClick={onAccept}
                >
                    Join
                </button>
                <button
                    className='rename__cancel invite__decline'
                    onClick={onDecline}
                >
                    Decline
                </button>
                <button
                    className='rename__cancel dial__block invite__block'
                    onClick={onBlock}
                >
                    Decline and block {inviterName}
                </button>
            </div>
        </div>
    );
};

export default React.memo(GroupInviteModal);
