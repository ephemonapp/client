import { ChatStore, MessageKey, useMessageKeys, useTyping } from '../../../lib/chatStore';
import { ChatWindowMessageType } from '../../../types/chatMessageType';
import { MemberNumber } from '../../../types/conversation';
import { ArrowDownIcon } from '../../icons';
import MessageBubble, { GroupAuthor } from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtualizer, VirtualizerHandle } from 'virtua';

export type MessageListHandle = {
    scrollToMessage(entry: MessageKey): void;
    pinToBottom(): void;
};

type MessageListProps = {
    store: ChatStore;
    onReply: (message: ChatWindowMessageType) => void;
    onReact: (id: MessageKey, event: React.MouseEvent) => void;
    onDoubleReact: (message: ChatWindowMessageType) => void;
    onSeen: (id: MessageKey) => void;
    onRetry: () => void;
    authorOf?: (author?: MemberNumber) => GroupAuthor | undefined;
    onOpenAuthor?: (publicKey: string, name: string | undefined) => void;
    onOpenReceipts?: (message: ChatWindowMessageType) => void;
    ownSeenOf?: (message: ChatWindowMessageType) => boolean;
    handleRef?: React.RefObject<MessageListHandle | null>;
};

const STICK_THRESHOLD = 120;
const HIGHLIGHT_HOLD = 1000;
const SMOOTH_SPAN = 3;
const TYPING_ENTRY = 'typing';

type ListEntry = MessageKey | typeof TYPING_ENTRY;

function isShortJump(virtualizer: VirtualizerHandle, index: number): boolean {
    return (
        Math.abs(virtualizer.getItemOffset(index) - virtualizer.scrollOffset) <= virtualizer.viewportSize * SMOOTH_SPAN
    );
}

function rowInView(scroller: HTMLElement, entry: ListEntry): { row: DOMRect; view: DOMRect } | undefined {
    const element = scroller.querySelector(`[data-entry="${CSS.escape(entry)}"]`);
    if (!element) return undefined;
    const view = scroller.getBoundingClientRect();
    const row = element.getBoundingClientRect();
    return row.bottom > view.top && row.top < view.bottom ? { row, view } : undefined;
}

function alignmentOf(store: ChatStore, entry: ListEntry): string {
    if (entry === TYPING_ENTRY) return 'start';
    switch (store.getMessage(entry)?.sender) {
        case 'you':
            return 'end';
        case 'peer':
            return 'start';
        default:
            return 'center';
    }
}

function isMessage(store: ChatStore, entry: ListEntry): boolean {
    if (entry === TYPING_ENTRY) return false;
    const sender = store.getMessage(entry)?.sender;
    return sender === 'you' || sender === 'peer';
}

function newestMessage(store: ChatStore, entries: ReadonlyArray<ListEntry>): ListEntry | undefined {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (isMessage(store, entries[index])) return entries[index];
    }
    return undefined;
}

const MessageList: React.FC<MessageListProps> = ({
    store,
    onReply,
    onReact,
    onDoubleReact,
    onSeen,
    onRetry,
    authorOf,
    onOpenAuthor,
    onOpenReceipts,
    ownSeenOf,
    handleRef,
}) => {
    const keys = useMessageKeys(store);
    const typing = useTyping(store);
    const entries = useMemo<ReadonlyArray<ListEntry>>(() => (typing ? [...keys, TYPING_ENTRY] : keys), [keys, typing]);

    const scrollRef = useRef<HTMLDivElement>(null);
    const virtualizerRef = useRef<VirtualizerHandle>(null);
    const stickToBottomRef = useRef(true);
    const entriesRef = useRef(entries);
    entriesRef.current = entries;
    const pendingJumpRef = useRef<{ entry: ListEntry; index: number } | undefined>(undefined);
    const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const [tailLost, setTailLost] = useState(false);
    const pinningRef = useRef(true);

    const scrollToBottom = useCallback(() => {
        const last = entriesRef.current.length - 1;
        if (last < 0) return;
        pinningRef.current = true;
        virtualizerRef.current?.scrollToIndex(last, { align: 'end' });
    }, []);

    const syncTail = useCallback(() => {
        const scroller = scrollRef.current;
        if (!scroller) return;
        const newest = newestMessage(store, entriesRef.current);
        const lost = newest !== undefined && rowInView(scroller, newest) === undefined;

        if (pinningRef.current) {
            if (lost) return;
            pinningRef.current = false;
        }
        setTailLost(lost);
    }, []);

    const followBottom = useCallback(() => {
        if (stickToBottomRef.current) scrollToBottom();
    }, [scrollToBottom]);

    const settleJump = useCallback(() => {
        const pending = pendingJumpRef.current;
        const scroller = scrollRef.current;
        if (!pending || !scroller) return;

        const seen = rowInView(scroller, pending.entry);
        if (!seen) return;

        pendingJumpRef.current = undefined;

        if (seen.row.height > seen.view.height && seen.row.top < seen.view.top) {
            virtualizerRef.current?.scrollToIndex(pending.index, { align: 'start' });
        }

        store.setHighlight(pending.entry === TYPING_ENTRY ? undefined : pending.entry);
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => store.setHighlight(undefined), HIGHLIGHT_HOLD);
    }, [store]);

    const onScroll = useCallback(() => {
        const element = scrollRef.current;
        if (!element) return;
        stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_THRESHOLD;
        settleJump();
        syncTail();
    }, [settleJump, syncTail]);

    const onScrollEnd = useCallback(() => {
        settleJump();
        pinningRef.current = false;
        syncTail();
    }, [settleJump, syncTail]);

    useEffect(() => {
        followBottom();
        syncTail();
    }, [entries, followBottom, syncTail]);

    useEffect(
        () => () => {
            clearTimeout(highlightTimerRef.current);
            store.setHighlight(undefined);
        },
        [store],
    );

    const scrollToMessage = useCallback(
        (entry: MessageKey) => {
            const index = entriesRef.current.indexOf(entry);
            const virtualizer = virtualizerRef.current;
            if (index < 0 || !virtualizer) return;

            pendingJumpRef.current = { entry, index };
            virtualizer.scrollToIndex(index, {
                align: virtualizer.getItemSize(index) > virtualizer.viewportSize ? 'start' : 'center',
                smooth: isShortJump(virtualizer, index),
            });
            settleJump();
        },
        [settleJump],
    );

    const pinToBottom = useCallback(() => {
        stickToBottomRef.current = true;
        scrollToBottom();
    }, [scrollToBottom]);

    const jumpToLatest = useCallback(() => {
        const last = entriesRef.current.length - 1;
        const virtualizer = virtualizerRef.current;
        if (last < 0 || !virtualizer) return;
        stickToBottomRef.current = true;
        pinningRef.current = true;
        virtualizer.scrollToIndex(last, { align: 'end', smooth: isShortJump(virtualizer, last) });
    }, []);

    const handle = useMemo<MessageListHandle>(() => ({ scrollToMessage, pinToBottom }), [scrollToMessage, pinToBottom]);
    if (handleRef) handleRef.current = handle;

    const renderRow = useCallback(
        (entry: ListEntry) => (
            <Row
                store={store}
                entry={entry}
                onReply={onReply}
                onReact={onReact}
                onDoubleReact={onDoubleReact}
                onSeen={onSeen}
                onRetry={onRetry}
                onScrollToMessage={scrollToMessage}
                authorOf={authorOf}
                onOpenAuthor={onOpenAuthor}
                onOpenReceipts={onOpenReceipts}
                ownSeenOf={ownSeenOf}
            />
        ),
        [
            store,
            onReply,
            onReact,
            onDoubleReact,
            onSeen,
            onRetry,
            scrollToMessage,
            authorOf,
            onOpenAuthor,
            onOpenReceipts,
        ],
    );

    return (
        <div className='msg-area'>
            <div
                className='msg-list'
                ref={scrollRef}
                onScroll={onScroll}
            >
                <div className='msg-list__inner'>
                    <Virtualizer
                        ref={virtualizerRef}
                        scrollRef={scrollRef}
                        data={entries}
                        onScrollEnd={onScrollEnd}
                    >
                        {renderRow}
                    </Virtualizer>
                </div>
            </div>
            <button
                className={`msg-jump${tailLost ? ' msg-jump--shown' : ''}`}
                type='button'
                title='Latest messages'
                inert={!tailLost}
                onClick={jumpToLatest}
            >
                <ArrowDownIcon />
            </button>
        </div>
    );
};

type RowProps = {
    store: ChatStore;
    entry: ListEntry;
    onReply: (message: ChatWindowMessageType) => void;
    onReact: (id: MessageKey, event: React.MouseEvent) => void;
    onDoubleReact: (message: ChatWindowMessageType) => void;
    onSeen: (id: MessageKey) => void;
    onRetry: () => void;
    onScrollToMessage: (entry: MessageKey) => void;
    authorOf?: (author?: MemberNumber) => GroupAuthor | undefined;
    onOpenAuthor?: (publicKey: string, name: string | undefined) => void;
    onOpenReceipts?: (message: ChatWindowMessageType) => void;
    ownSeenOf?: (message: ChatWindowMessageType) => boolean;
};

const Row = React.memo<RowProps>(function Row({ store, entry, ...handlers }) {
    if (entry === TYPING_ENTRY) {
        return (
            <div className='msg-row msg-row--start'>
                <TypingIndicator />
            </div>
        );
    }

    const record = store.getMessage(entry);
    const isMarker = record?.sender === 'date';

    return (
        <div
            className={`msg-row msg-row--${alignmentOf(store, entry)}`}
            data-entry={entry}
        >
            {isMarker ? (
                record && <div className='msg-chip msg-chip--day'>{record.text}</div>
            ) : (
                <MessageBubble
                    store={store}
                    entry={entry}
                    {...handlers}
                />
            )}
        </div>
    );
});

export default React.memo(MessageList);
