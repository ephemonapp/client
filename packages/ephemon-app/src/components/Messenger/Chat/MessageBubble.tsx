import { ChatStore, MessageKey, useHighlighted, useMessage } from '../../../lib/chatStore';
import { fmtTime } from '../../../lib/time';
import { ChatWindowMessageType } from '../../../types/chatMessageType';
import { MemberNumber } from '../../../types/conversation';
import { formatTimestampLong, now, serverTime } from '../../../utils/functions';
import { CheckIcon, DoubleCheckIcon, ReplyIcon, SmileyIcon, SpinnerIcon } from '../../icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';

export type GroupAuthor = {
    publicKey: string;
    name: string | undefined;
    display: string;
};

type MessageBubbleProps = {
    store: ChatStore;
    entry: MessageKey;
    onReply: (message: ChatWindowMessageType) => void;
    onReact: (id: MessageKey, event: React.MouseEvent) => void;
    onDoubleReact: (message: ChatWindowMessageType) => void;
    onSeen: (id: MessageKey) => void;
    onScrollToMessage: (entry: MessageKey) => void;
    onRetry: () => void;
    authorOf?: (author?: MemberNumber) => GroupAuthor | undefined;
    onOpenAuthor?: (publicKey: string, name: string | undefined) => void;
    onOpenReceipts?: (message: ChatWindowMessageType) => void;
    ownSeenOf?: (message: ChatWindowMessageType) => boolean;
};

const MUTED = { color: 'var(--muted)' } as const;
const PRIMARY = { color: 'var(--pri)' } as const;

const Receipt = React.memo<{ deliveredTs?: number; seenTs?: number; onOpen?: () => void }>(function Receipt({
    deliveredTs,
    seenTs,
    onOpen,
}) {
    if (deliveredTs) {
        if (!seenTs) {
            return (
                <span
                    className='bubble__receipt'
                    title={`Delivered ${formatTimestampLong(deliveredTs)}`}
                    onClick={onOpen}
                >
                    <CheckIcon style={MUTED} />
                </span>
            );
        }
        return (
            <span
                className='bubble__receipt'
                title={`Delivered ${formatTimestampLong(deliveredTs)}, Seen ${formatTimestampLong(seenTs)}`}
                onClick={onOpen}
            >
                <DoubleCheckIcon style={PRIMARY} />
            </span>
        );
    }
    return (
        <span
            className='bubble__receipt'
            title='Undelivered'
            onClick={onOpen}
        >
            <SpinnerIcon style={MUTED} />
        </span>
    );
});

const SWIPE_THRESHOLD = 50;
const WHEEL_THRESHOLD = 100;
const SWIPE_SLOP = 6;
const SWIPE_RETURN = 'transform 0.22s ease';
const UNDELIVERED_GRACE = 10 * 1000;

const MessageBubble: React.FC<MessageBubbleProps> = ({
    store,
    entry,
    onReply,
    onReact,
    onDoubleReact,
    onSeen,
    onScrollToMessage,
    onRetry,
    authorOf,
    onOpenAuthor,
    onOpenReceipts,
    ownSeenOf,
}) => {
    const message = useMessage(store, entry);
    const highlighted = useHighlighted(store, entry);
    const author = message?.sender === 'peer' ? authorOf?.(message.author) : undefined;
    const openAuthor = useCallback(() => {
        if (author !== undefined) onOpenAuthor?.(author.publicKey, author.name);
    }, [author, onOpenAuthor]);

    const topMarkerRef = useRef<HTMLDivElement>(null);
    const bottomMarkerRef = useRef<HTMLDivElement>(null);
    const seenRef = useRef<boolean>(message !== undefined && ownSeenOf?.(message) === true);
    const topSeenRef = useRef<boolean>(false);
    const bottomSeenRef = useRef<boolean>(false);
    const wheelRef = useRef<HTMLDivElement>(null);
    const wheelAccumRef = useRef<number>(0);
    const wheelInteractionAllowedRef = useRef<boolean>(true);
    const wheelResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const sender = message?.sender;
    const id = message?.id;
    const hasMessage = message !== undefined;

    const [stuck, setStuck] = useState(false);
    const waiting = sender === 'you' && message?.delivered == null;
    const sentAt = message?.timestamp;

    useEffect(() => {
        if (!waiting || sentAt === undefined) {
            setStuck(false);
            return;
        }
        const waited = serverTime() - sentAt;
        if (waited >= UNDELIVERED_GRACE) {
            setStuck(true);
            return;
        }
        const timer = setTimeout(() => setStuck(true), UNDELIVERED_GRACE - waited);
        return () => clearTimeout(timer);
    }, [waiting, sentAt]);

    useEffect(() => {
        if (sender !== 'peer' || id === undefined || seenRef.current) return;

        const options: IntersectionObserverInit = { root: null, rootMargin: '0px', threshold: 0.1 };

        const markSeen = () => {
            if (topSeenRef.current && bottomSeenRef.current && !seenRef.current) {
                seenRef.current = true;
                onSeen(id);
                topObserver.disconnect();
                bottomObserver.disconnect();
            }
        };

        const topObserver = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting) {
                topSeenRef.current = true;
                markSeen();
            }
        }, options);

        const bottomObserver = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting) {
                bottomSeenRef.current = true;
                markSeen();
            }
        }, options);

        if (topMarkerRef.current) topObserver.observe(topMarkerRef.current);
        if (bottomMarkerRef.current) bottomObserver.observe(bottomMarkerRef.current);

        return () => {
            topObserver.disconnect();
            bottomObserver.disconnect();
        };
    }, [sender, id, onSeen]);

    const rowRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ pointer: number; x: number; y: number; held: boolean } | undefined>(undefined);

    const slide = useCallback((offset: number, animate: boolean) => {
        const element = rowRef.current;
        if (!element) return;
        element.style.transition = animate ? SWIPE_RETURN : '';
        element.style.transform = offset ? `translateX(${offset}px)` : '';
    }, []);

    const reply = useCallback(() => {
        if (message) onReply(message);
    }, [message, onReply]);

    const replyRef = useRef(reply);
    replyRef.current = reply;

    const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        dragRef.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, held: false };
    }, []);

    const onPointerMove = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            const drag = dragRef.current;
            if (!drag || drag.pointer !== event.pointerId) return;

            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;

            if (!drag.held) {
                if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
                if (Math.abs(dy) >= Math.abs(dx)) {
                    dragRef.current = undefined;
                    return;
                }
                drag.held = true;
                event.currentTarget.setPointerCapture(event.pointerId);
            }

            if (dx >= 0) {
                slide(0, true);
                return;
            }
            if (-dx > SWIPE_THRESHOLD) {
                dragRef.current = undefined;
                slide(0, true);
                replyRef.current();
                return;
            }
            slide(dx, false);
        },
        [slide],
    );

    const onPointerUp = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            const drag = dragRef.current;
            if (!drag || drag.pointer !== event.pointerId) return;
            dragRef.current = undefined;
            slide(0, true);
        },
        [slide],
    );

    useEffect(() => {
        const element = wheelRef.current;
        if (!element) return;

        const onWheel = (event: WheelEvent) => {
            const { deltaX, deltaY } = event;
            if (Math.abs(deltaX) < Math.abs(deltaY)) return;
            if (deltaX <= 0) {
                slide(0, true);
                return;
            }

            event.preventDefault();
            if (wheelInteractionAllowedRef.current) {
                wheelAccumRef.current += deltaX;
                slide(-wheelAccumRef.current, true);
                if (wheelAccumRef.current > WHEEL_THRESHOLD) {
                    replyRef.current();
                    wheelAccumRef.current = 0;
                    slide(0, true);
                    wheelInteractionAllowedRef.current = false;
                    setTimeout(() => {
                        wheelInteractionAllowedRef.current = true;
                    }, 1000);
                }
            }
            clearTimeout(wheelResetTimeoutRef.current);
            wheelResetTimeoutRef.current = setTimeout(() => {
                wheelAccumRef.current = 0;
                slide(0, true);
            }, 500);
        };

        element.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            element.removeEventListener('wheel', onWheel);
            clearTimeout(wheelResetTimeoutRef.current);
        };
    }, [slide, hasMessage]);

    const react = useCallback(
        (event: React.MouseEvent) => {
            if (id !== undefined) onReact(id, event);
        },
        [onReact, id],
    );

    const doubleReact = useCallback(() => {
        if (message) onDoubleReact(message);
    }, [message, onDoubleReact]);

    const scrollToQuoted = useCallback(() => {
        if (message?.reply_to?.id !== undefined) onScrollToMessage(message.reply_to.id);
    }, [message, onScrollToMessage]);

    if (!message) return null;

    const isYou = message.sender === 'you';
    const isReplyToYou = message.reply_to?.sender === 'you';
    const chips = (message.reactions ?? []).filter((entry) => entry.value.length > 0);
    const chipTitle = useCallback(
        (authors: ReadonlyArray<MemberNumber>): string =>
            authors.map((author) => authorOf?.(author)?.display ?? `Member ${Number(author)}`).join(', '),
        [authorOf],
    );
    const hasReaction = chips.length > 0 || !!message.reaction?.value;
    const chip = [...chips].sort((left, right) => right.authors.length - left.authors.length)[0];
    const chipLabel =
        chip === undefined ? '' : `${chip.value}${chip.authors.length > 1 ? ` ${chip.authors.length}` : ''}`;
    const openReceipts = useCallback(() => {
        if (message !== undefined) onOpenReceipts?.(message);
    }, [message, onOpenReceipts]);
    const openDetails = useCallback(
        (event: React.MouseEvent) => {
            event.stopPropagation();
            if (message !== undefined) onOpenReceipts?.(message);
        },
        [message, onOpenReceipts],
    );
    const more =
        chips.length > 1 && onOpenReceipts !== undefined ? (
            <span
                className='bubble__reaction-more'
                title='Who reacted'
                onClick={openDetails}
            >
                +
            </span>
        ) : null;
    const marginBottom = hasReaction || !isYou ? 11 : 2;

    const delta = now() - serverTime();
    const messageTs = message.timestamp + delta;
    const deliveredTs = message.delivered?.timestamp ? message.delivered.timestamp + delta : undefined;
    const seenTs = message.seen?.timestamp ? message.seen.timestamp + delta : undefined;
    const reactionTs = message.reaction?.timestamp ? message.reaction.timestamp + delta : undefined;

    const mark = highlighted ? ' bubble--highlight' : '';
    const timeTitle = `${isYou ? 'Sent' : 'Received'} ${formatTimestampLong(messageTs)}`;
    const reactionTitle = reactionTs ? `Reacted ${formatTimestampLong(reactionTs)}` : undefined;

    const replyQuote = message.reply_to ? (
        <div
            className={`bubble__reply bubble__reply--${isReplyToYou ? 'you' : 'peer'}`}
            onClick={scrollToQuoted}
        >
            <span>{message.reply_to.text}</span>
        </div>
    ) : null;

    if (isYou) {
        return (
            <div
                className='bubble-row bubble-row--you'
                style={{ marginBottom }}
                ref={rowRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                <button
                    className='reply-btn'
                    title='Reply'
                    onClick={reply}
                >
                    <ReplyIcon />
                </button>
                <div
                    className={`bubble bubble--you${stuck ? ' bubble--undelivered' : ''}${mark}`}
                    ref={wheelRef}
                >
                    {replyQuote}
                    <span className='bubble__text'>{message.text}</span>
                    <div className='bubble__meta'>
                        <span
                            className='bubble__time'
                            title={timeTitle}
                        >
                            {fmtTime(messageTs)}
                        </span>
                        <Receipt
                            deliveredTs={deliveredTs}
                            seenTs={seenTs}
                            onOpen={openReceipts}
                        />
                    </div>
                    {stuck && (
                        <button
                            className='bubble__retry'
                            type='button'
                            onClick={onRetry}
                        >
                            Try again?
                        </button>
                    )}
                    {chip !== undefined ? (
                        <span
                            className='bubble__reaction'
                            title={chipTitle(chip.authors)}
                            onClick={openReceipts}
                        >
                            <span className='bubble__reaction-value'>{chipLabel}</span>
                            {more}
                        </span>
                    ) : (
                        hasReaction && (
                            <span
                                className='bubble__reaction'
                                title={reactionTitle}
                            >
                                {message.reaction!.value}
                            </span>
                        )
                    )}
                </div>
            </div>
        );
    }

    return (
        <div
            className='bubble-row bubble-row--peer'
            style={{ marginBottom }}
            ref={rowRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
        >
            <div
                className={`bubble bubble--peer${mark}`}
                ref={wheelRef}
                onDoubleClick={doubleReact}
            >
                <div
                    ref={topMarkerRef}
                    className='bubble__marker'
                />
                {author !== undefined && (
                    <span
                        className='bubble__author'
                        onClick={openAuthor}
                    >
                        {author.display}
                    </span>
                )}
                {replyQuote}
                <span className='bubble__text'>{message.text}</span>
                <div className='bubble__meta bubble__meta--peer'>
                    <span
                        className='bubble__time'
                        title={timeTitle}
                    >
                        {fmtTime(messageTs)}
                    </span>
                </div>
                {chip !== undefined ? (
                    <span
                        className='bubble__reaction bubble__reaction--peer'
                        title={chipTitle(chip.authors)}
                        onClick={react}
                    >
                        <span className='bubble__reaction-value'>{chipLabel}</span>
                        {more}
                    </span>
                ) : hasReaction ? (
                    <span
                        className='bubble__reaction bubble__reaction--peer'
                        title={reactionTitle}
                        onClick={react}
                    >
                        {message.reaction!.value}
                    </span>
                ) : (
                    <span
                        className='bubble__add'
                        title='Add reaction'
                        onClick={react}
                    >
                        <SmileyIcon />
                    </span>
                )}
                <div
                    ref={bottomMarkerRef}
                    className='bubble__marker'
                />
            </div>
            <button
                className='reply-btn'
                title='Reply'
                onClick={reply}
            >
                <ReplyIcon />
            </button>
        </div>
    );
};

export default React.memo(MessageBubble);
