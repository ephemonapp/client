import { useChat } from '../../../hooks/useChat';
import { ConnectionCallbacks } from '../../../hooks/useConnectionCallbacksCache';
import { setConnectionNotice, setConnectionProgress, useActiveConversation } from '../../../lib/connectionStore';
import { displayName } from '../../../lib/identicon';
import { ChatWindowMessageType } from '../../../types/chatMessageType';
import { ConversationId, MemberNumber } from '../../../types/conversation';
import { EventId } from '../../../types/eventId';
import { ReceiptListEntry } from '../../modals/ReceiptListModal';
import ChatHeader from './ChatHeader';
import Composer, { ComposerHandle } from './Composer';
import ConnectingSlot from './ConnectingSlot';
import IntroduceSlot from './IntroduceSlot';
import { GroupAuthor } from './MessageBubble';
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
    readOnly: boolean;
    group?: boolean;
    memberName?: string;
    members?: ReadonlyArray<{ memberNumber: number; publicKey: string; name?: string }>;
    ownMemberNumber?: number;
    onOpenMemberName: (id: ConversationId) => void;
    onIntroduce: (id: ConversationId, name: string) => void;
    onOpenReceipts?: (entries: ReadonlyArray<ReceiptListEntry>) => void;
    onBack: () => void;
    onOpenPeerQr: (publicKey: string, name: string | undefined) => void;
    onOpenRename: (id: ConversationId, current: string) => void;
    onOpenAddMember: (id: ConversationId) => void;
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
    readOnly,
    group,
    memberName,
    members,
    ownMemberNumber,
    onOpenMemberName,
    onIntroduce,
    onOpenReceipts,
    onBack,
    onOpenPeerQr,
    onOpenRename,
    onOpenAddMember,
    onDelete,
}) => {
    const onScreen = useActiveConversation() === id && columnVisible;
    const chat = useChat({ conversationId: id, ownMemberNumber, callbacks });
    const [anchor, setAnchor] = useState<ReactionAnchor | null>(null);

    useEffect(() => {
        callbacks.events.setOnProgress((progress) => setConnectionProgress(id, progress));
    }, [callbacks, id]);

    const ownSeenOf = useCallback(
        (message: ChatWindowMessageType): boolean =>
            ownMemberNumber !== undefined &&
            (message.seenBy ?? []).some((entry) => Number(entry.author) === Number(ownMemberNumber)),
        [ownMemberNumber],
    );

    const onSeen = useCallback(
        (messageId: EventId) => {
            const message = chat.store.getMessage(messageId);
            const mine =
                ownMemberNumber !== undefined &&
                (message?.seenBy ?? []).some((entry) => Number(entry.author) === Number(ownMemberNumber));
            if (mine) return;
            void chat.send.seen(messageId).catch(() => {});
        },
        [chat.send, chat.store, ownMemberNumber],
    );

    const listRef = useRef<MessageListHandle | null>(null);
    const composerRef = useRef<ComposerHandle | null>(null);

    const onReply = useCallback(
        (message: ChatWindowMessageType) => {
            const sender = message.sender as 'you' | 'peer';
            chat.replyTo.set(message.id, sender, message.text, () => listRef.current?.scrollToMessage(message.id));
            composerRef.current?.focus();
        },
        [chat.replyTo],
    );

    const cancelReply = useCallback(() => chat.replyTo.reset(), [chat.replyTo]);

    const openReactionMenu = useCallback(
        (messageId: EventId, event: React.MouseEvent) => {
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

    const ownReaction = useCallback(
        (message: ChatWindowMessageType | undefined): string | undefined => {
            if (message === undefined) return undefined;
            if (message.reactions === undefined) return message.reaction?.value;
            const mine = ownMemberNumber;
            if (mine === undefined) return undefined;
            return message.reactions.find((entry) => entry.authors.some((author) => Number(author) === Number(mine)))
                ?.value;
        },
        [ownMemberNumber],
    );

    const pickReaction = useCallback(
        (emoji: string) => {
            if (!anchor) return;
            const current = ownReaction(chat.store.getMessage(anchor.msgId));
            chat.send.reaction(anchor.msgId, current === emoji ? '' : emoji).catch(() => {});
            setAnchor(null);
        },
        [anchor, chat.store, chat.send, ownReaction],
    );

    const doubleReact = useCallback(
        (message: ChatWindowMessageType) => {
            chat.send.reaction(message.id, ownReaction(message) ? '' : '💜').catch(() => {});
        },
        [chat.send, ownReaction],
    );

    const onSend = useCallback(
        (text: string) => {
            listRef.current?.pinToBottom();
            void chat.send.text(text).catch(() => {});
        },
        [chat.send],
    );
    const onTyping = useCallback(() => void chat.send.action('typing').catch(() => {}), [chat.send]);

    const openMemberName = useCallback(() => onOpenMemberName(id), [id, onOpenMemberName]);
    const openReceipts = useCallback(
        (message: ChatWindowMessageType) => {
            const ownKey = members?.find((member) => Number(member.memberNumber) === Number(message.author));
            const read = new Set((message.seenBy ?? []).map((entry) => Number(entry.author)));
            const got = new Set((message.deliveredBy ?? []).map((entry) => Number(entry.author)));
            const entries = (members ?? [])
                .filter((member) => member.publicKey !== ownKey?.publicKey)
                .map((member) => ({
                    publicKey: member.publicKey,
                    display: displayName(member.name, member.publicKey),
                    reaction: (message.reactions ?? []).find((entry) =>
                        entry.authors.some((author) => Number(author) === Number(member.memberNumber)),
                    )?.value,
                    state: read.has(Number(member.memberNumber))
                        ? ('read' as const)
                        : got.has(Number(member.memberNumber))
                          ? ('received' as const)
                          : ('waiting' as const),
                }));
            onOpenReceipts?.(entries);
        },
        [members, onOpenReceipts],
    );
    const authorOf = useCallback(
        (author?: MemberNumber): GroupAuthor | undefined => {
            if (group !== true || author === undefined) return undefined;
            const member = members?.find((candidate) => Number(candidate.memberNumber) === Number(author));
            if (member === undefined) return undefined;
            return {
                publicKey: member.publicKey,
                name: member.name,
                display: displayName(member.name, member.publicKey),
            };
        },
        [group, members],
    );
    const anonymousInGroup = group === true && (memberName ?? '') === '';

    const onReconnect = useCallback(() => {
        setConnectionNotice(id, undefined);
        void callbacks.lifecycle.open().catch(() => {});
    }, [callbacks, id]);
    const onAddMemberClick = useCallback(() => onOpenAddMember(id), [id, onOpenAddMember]);

    const onClear = useCallback(() => void chat.clear().catch(() => {}), [chat]);
    const onShowPeerQr = useCallback(() => onOpenPeerQr(publicKey, name), [onOpenPeerQr, publicKey, name]);
    const onRename = useCallback(
        () => onOpenRename(id, displayName(name, publicKey)),
        [onOpenRename, id, name, publicKey],
    );
    const onRemove = useCallback(() => onDelete(id), [onDelete, id]);
    const introduce = useCallback((chosen: string) => onIntroduce(id, chosen), [id, onIntroduce]);

    if (!onScreen) return null;

    return (
        <div className='chat'>
            <ChatHeader
                conversationId={id}
                name={name}
                publicKey={publicKey}
                group={group === true}
                onMemberName={openMemberName}
                isMobile={isMobile}
                onBack={onBack}
                onReconnect={onReconnect}
                onRename={onRename}
                onAddMember={onAddMemberClick}
                onShowPeerQr={onShowPeerQr}
                onClear={onClear}
                onDelete={onRemove}
            />
            {anonymousInGroup ? (
                <IntroduceSlot
                    groupName={displayName(name, publicKey)}
                    onIntroduce={introduce}
                />
            ) : (
                <>
                    <MessageList
                        authorOf={authorOf}
                        ownSeenOf={ownSeenOf}
                        onOpenReceipts={group === true ? openReceipts : undefined}
                        onOpenAuthor={onOpenPeerQr}
                        store={chat.store}
                        handleRef={listRef}
                        onReply={onReply}
                        onReact={openReactionMenu}
                        onDoubleReact={doubleReact}
                        onSeen={onSeen}
                        onRetry={onReconnect}
                    />
                    <div className='chat__footer'>
                        {readOnly && (
                            <div className='chat__observer'>
                                Ephemon is active in another tab. This one only shows saved history.
                            </div>
                        )}
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
                            disabled={readOnly}
                        />
                    </div>
                    {anchor && (
                        <ReactionPicker
                            anchor={anchor}
                            chosen={ownReaction(chat.store.getMessage(anchor.msgId))}
                            onPick={pickReaction}
                            onClose={closeReactionMenu}
                        />
                    )}
                </>
            )}
        </div>
    );
};

export default React.memo(ChatPane);
