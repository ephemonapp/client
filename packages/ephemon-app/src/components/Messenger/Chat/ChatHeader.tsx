import { useConnectionStatus } from '../../../lib/connectionStore';
import { displayName, hashColor, initials } from '../../../lib/identicon';
import { connStatus } from '../../../lib/status';
import { BackIcon, KebabIcon, PencilIcon, QrIcon, RefreshIcon, TrashIcon, CloseIcon } from '../../icons';
import React, { useCallback, useState } from 'react';

type ChatHeaderProps = {
    name: string | undefined;
    publicKey: string;
    isMobile: boolean;
    onBack: () => void;
    onReconnect: () => void;
    onRename: () => void;
    onShowPeerQr: () => void;
    onClear: () => void;
    onDelete: () => void;
};

const ChatHeader: React.FC<ChatHeaderProps> = ({
    name,
    publicKey,
    isMobile,
    onBack,
    onReconnect,
    onRename,
    onShowPeerQr,
    onClear,
    onDelete,
}) => {
    const { state, transport, notice } = useConnectionStatus(publicKey);
    const { text, color } = connStatus(state, transport, notice);
    const [kebabOpen, setKebabOpen] = useState(false);

    const toggleKebab = useCallback(() => setKebabOpen((open) => !open), []);
    const run = useCallback((action: () => void) => {
        setKebabOpen(false);
        action();
    }, []);

    const reconnect = useCallback(() => run(onReconnect), [run, onReconnect]);
    const rename = useCallback(() => run(onRename), [run, onRename]);
    const showPeerQr = useCallback(() => run(onShowPeerQr), [run, onShowPeerQr]);
    const clear = useCallback(() => run(onClear), [run, onClear]);
    const remove = useCallback(() => run(onDelete), [run, onDelete]);

    return (
        <div className='chat-header'>
            {isMobile && (
                <button
                    className='chat-header__back'
                    onClick={onBack}
                >
                    <BackIcon />
                </button>
            )}
            <div
                className='chat-header__avatar'
                style={{ background: hashColor(publicKey) }}
            >
                {initials(name, publicKey)}
            </div>
            <div className='chat-header__meta'>
                <div className='chat-header__name'>{displayName(name, publicKey)}</div>
                <div
                    className='chat-header__status'
                    style={{ color }}
                >
                    <span
                        className='chat-header__status-dot'
                        style={{ background: color }}
                    />
                    {text}
                </div>
            </div>
            <button
                className='icon-btn'
                title='More'
                onClick={toggleKebab}
            >
                <KebabIcon />
            </button>
            {kebabOpen && (
                <div
                    className='kebab-overlay'
                    onClick={toggleKebab}
                />
            )}
            {kebabOpen && (
                <div className='kebab'>
                    <div
                        className='kebab__item'
                        onClick={reconnect}
                    >
                        <RefreshIcon />
                        {state === 'open' || state === 'degraded' ? 'Reconnect' : 'Connect'}
                    </div>
                    <div className='kebab__divider' />
                    <div
                        className='kebab__item'
                        onClick={rename}
                    >
                        <PencilIcon />
                        Rename contact
                    </div>
                    <div
                        className='kebab__item'
                        onClick={showPeerQr}
                    >
                        <QrIcon
                            w={16}
                            h={16}
                        />
                        Show contact's QR code
                    </div>
                    <div
                        className='kebab__item'
                        onClick={clear}
                    >
                        <TrashIcon />
                        Clear history
                    </div>
                    <div className='kebab__divider' />
                    <div
                        className='kebab__item kebab__item--danger'
                        onClick={remove}
                    >
                        <CloseIcon
                            w={16}
                            h={16}
                            sw={1.7}
                        />
                        Delete chat
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(ChatHeader);
