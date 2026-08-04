import { useChat } from '../../../hooks/useChat';
import { ConnectionCallbacks } from '../../../hooks/useConnectionCallbacksCache';
import { messageKey } from '../../../lib/chatStore';
import { setConnectionNotice, setConnectionProgress, useActiveConversation } from '../../../lib/connectionStore';
import { displayName } from '../../../lib/identicon';
import { ChatWindowMessageType } from '../../../types/chatMessageType';
import { ConversationId } from '../../../types/conversation';
import ChatHeader from './ChatHeader';
import Composer, { ComposerHandle } from './Composer';
import ConnectingSlot from './ConnectingSlot';
import MessageList, { MessageListHandle } from './MessageList';
import ReactionPicker, { ReactionAnchor } from './ReactionPicker';
import ReplySlot from './ReplySlot';
import React, { useCallback, useEffect, useRef, useState } from 'react';

type ChatPaneProps = {
    id: ConversationId;
    columnVisible: boolean;
    isMobile: boolean;
    name: string | undefined;
    publicKey: string;
    callbacks: ConnectionCallbacks;
    onBack: () => void;
    onOpenPeerQr: (publicKey: string, name: string | undefined) => void;
    onOpenRename: (id: ConversationId, current: string) => void;
    onDelete: (id: ConversationId) => void;
};

const MENU_W = 236;
const MENU_H = 150;

const ChatPane: React.FC<ChatPaneProps> = ({
    id,
    columnVisible,
    isMobile,
    name,
    publicKey,
    callbacks,
    onBack,
    onOpenPeerQr,
    onOpenRename,
    onDelete,
}) => {
    const onScreen = useActiveConversation() === id && columnVisible;
    const chat = useChat({ conversationId: id, callbacks });
    const [anchor, setAnchor] = useState<ReactionAnchor | null>(null);

    useEffect(() => {
        callbacks.events.setOnProgress((progress) => setConnectionProgress(id, progress));
    }, [callbacks, id]);

    const onSeen = useCallback((messageId: number) => void chat.send.seen(messageId).catch(() => {}), [chat.send]);

    const listRef = useRef<MessageListHandle | null>(null);
    const composerRef = useRef<ComposerHandle | null>(null);

    const onReply = useCallback(
        (message: ChatWindowMessageType) => {
            const sender = message.sender as 'you' | 'peer';
            chat.replyTo.set(message.id, sender, message.text, () =>
                listRef.current?.scrollToMessage(messageKey(message.id, sender)),
            );
            composerRef.current?.focus();
        },
        [chat.replyTo],
    );

    const cancelReply = useCallback(() => chat.replyTo.reset(), [chat.replyTo]);

    const openReactionMenu = useCallback(
        (messageId: number, event: React.MouseEvent) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const minX = isMobile ? 8 : 348;
            const maxX = Math.max(minX, window.innerWidth - MENU_W - 8);
            const x = Math.min(Math.max(rect.left + rect.width / 2 - MENU_W / 2, minX), maxX);
            const above = rect.top - MENU_H - 8 >= 8;
            setAnchor({
                msgId: messageId,
                x: Math.round(x),
                y: Math.round(
                    above ? rect.top - MENU_H - 8 : Math.min(rect.bottom + 8, window.innerHeight - MENU_H - 8),
                ),
                origin: above ? 'center bottom' : 'center top',
            });
        },
        [isMobile],
    );

    const closeReactionMenu = useCallback(() => setAnchor(null), []);

    const pickReaction = useCallback(
        (emoji: string) => {
            if (!anchor) return;
            const current = chat.store.getMessage(`peer:${anchor.msgId}`)?.reaction?.value;
            chat.send.reaction(anchor.msgId, current === emoji ? '' : emoji).catch(() => {});
            setAnchor(null);
        },
        [anchor, chat.store, chat.send],
    );

    const doubleReact = useCallback(
        (message: ChatWindowMessageType) => {
            chat.send.reaction(message.id, message.reaction?.value ? '' : '💜').catch(() => {});
        },
        [chat.send],
    );

    const onSend = useCallback(
        (text: string) => {
            listRef.current?.pinToBottom();
            void chat.send.text(text).catch(() => {});
        },
        [chat.send],
    );
    const onTyping = useCallback(() => void chat.send.action('typing').catch(() => {}), [chat.send]);

    const onReconnect = useCallback(() => {
        setConnectionNotice(id, undefined);
        void callbacks.lifecycle.open().catch(() => {});
    }, [callbacks, id]);
    const onClear = useCallback(() => void chat.clear().catch(() => {}), [chat]);
    const onShowPeerQr = useCallback(() => onOpenPeerQr(publicKey, name), [onOpenPeerQr, publicKey, name]);
    const onRename = useCallback(
        () => onOpenRename(id, displayName(name, publicKey)),
        [onOpenRename, id, name, publicKey],
    );
    const onRemove = useCallback(() => onDelete(id), [onDelete, id]);

    if (!onScreen) return null;

    return (
        <div className='chat'>
            <ChatHeader
                conversationId={id}
                name={name}
                publicKey={publicKey}
                isMobile={isMobile}
                onBack={onBack}
                onReconnect={onReconnect}
                onRename={onRename}
                onShowPeerQr={onShowPeerQr}
                onClear={onClear}
                onDelete={onRemove}
            />
            <MessageList
                store={chat.store}
                handleRef={listRef}
                onReply={onReply}
                onReact={openReactionMenu}
                onDoubleReact={doubleReact}
                onSeen={onSeen}
                onRetry={onReconnect}
            />
            <div className='chat__footer'>
                <ConnectingSlot
                    conversationId={id}
                    name={displayName(name, publicKey)}
                    onRetry={onReconnect}
                />
                <ReplySlot
                    store={chat.store}
                    onCancel={cancelReply}
                />
                <Composer
                    placeholder={`Message ${displayName(name, publicKey)}…`}
                    autoFocus={!isMobile}
                    handleRef={composerRef}
                    onSend={onSend}
                    onTyping={onTyping}
                />
            </div>
            {anchor && (
                <ReactionPicker
                    anchor={anchor}
                    onPick={pickReaction}
                    onClose={closeReactionMenu}
                />
            )}
        </div>
    );
};

export default React.memo(ChatPane);
