import { ChatStore, getChatStore, hasSeen, MessageKey, ReplyTarget } from '../lib/chatStore';
import { setUnreadCount } from '../lib/connectionStore';
import { subscribeHistoryChange } from '../lib/tabSync';
import { ActionType } from '../types/actionType';
import { ChatWindowMessageType } from '../types/chatMessageType';
import { ChatOperation, InboundChatEvent } from '../types/chatOperation';
import { ChatEventRecord, isChatMessageRecord } from '../types/chatRecord';
import { ConversationId } from '../types/conversation';
import { EventId } from '../types/eventId';
import { showNotification } from '../utils/functions';
import { ConnectionCallbacks } from './useConnectionCallbacksCache';
import { ConnectionState } from '@ephemon/core';
import { useCallback, useEffect, useMemo, useRef } from 'react';

export type ChatHook = {
    store: ChatStore;
    send: {
        action: (type: 'typing') => Promise<void>;
        text: (input: string) => Promise<void>;
        reaction: (id: EventId, reaction: string) => Promise<void>;
        seen: (id: EventId) => Promise<void>;
    };
    replyTo: {
        set: (id: EventId, sender: 'you' | 'peer', text: string, scrollToReply: () => void) => void;
        reset: () => void;
    };
    clear: () => Promise<void>;
};

type ChatHookProps = {
    conversationId: ConversationId;
    group?: boolean;
    ownMemberNumber?: number;
    /** A member who has not picked a group name yet emits nothing, receipts included. */
    anonymous?: boolean;
    callbacks: ConnectionCallbacks;
};

type PersistenceQueue = {
    store: ChatStore;
    dirty: Set<MessageKey>;
    cleared: ReadonlyArray<ChatEventRecord> | undefined;
    writing: Promise<void> | undefined;
};

const TYPING_TIMEOUT = 5 * 1000;
const TYPING_SEND_INTERVAL = 2 * 1000;

/** Receipts an anonymous member holds back are replayed once it introduces itself, oldest dropped first. */
const WITHHELD_RECEIPT_LIMIT = 512;

export function useChat({ conversationId, group, ownMemberNumber, anonymous, callbacks }: ChatHookProps): ChatHook {
    const {
        view: { setOrder },
        messaging: {
            send: sendMessage,
            history: { get: getHistory, save: saveHistory, clear: clearHistory },
        },
        events: { setOnStateChanged, setOnEvent },
    } = callbacks;

    const store = useMemo(() => getChatStore(conversationId), [conversationId]);

    const notifiedRef = useRef<Set<EventId>>(new Set());
    const hasBeenOpenedRef = useRef(false);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const lastTypingSentAtRef = useRef(Number.NEGATIVE_INFINITY);
    const typingSendPendingRef = useRef(false);
    const queueRef = useRef<PersistenceQueue | undefined>(undefined);
    const withheldRef = useRef<Set<EventId>>(new Set());

    useEffect(() => {
        let cancelled = false;
        getHistory()
            .then((history) => {
                if (cancelled) return;
                for (const record of history) {
                    if (isChatMessageRecord(record)) notifiedRef.current.add(record.id);
                }
                store.hydrate(history);
            })
            .catch(console.error);
        return () => {
            cancelled = true;
        };
    }, [store, getHistory]);

    useEffect(() => {
        let reading = false;
        let again = false;
        const reread = (): void => {
            if (reading) {
                again = true;
                return;
            }
            reading = true;
            getHistory()
                .then((history) => store.hydrate(history))
                .catch(console.error)
                .finally(() => {
                    reading = false;
                    if (!again) return;
                    again = false;
                    reread();
                });
        };
        return subscribeHistoryChange((change) => {
            if (change.id !== conversationId) return;
            if (change.cleared) store.clear();
            reread();
        });
    }, [conversationId, getHistory, store]);

    const ownHasSeen = useCallback(
        (message: ChatWindowMessageType): boolean => {
            if (ownMemberNumber !== undefined) return hasSeen(message, ownMemberNumber);
            // Without a member number, "seen by somebody" is only about this device in a two-party conversation.
            return group !== true && hasSeen(message, undefined);
        },
        [group, ownMemberNumber],
    );

    useEffect(() => {
        const recount = () => {
            const messages = store.getMessages();
            setUnreadCount(
                conversationId,
                messages.filter((message) => message.sender === 'peer' && !ownHasSeen(message)).length,
            );
        };
        recount();
        return store.subscribeAny(recount);
    }, [store, conversationId, ownHasSeen]);

    useEffect(() => {
        const queue =
            queueRef.current?.store === store
                ? queueRef.current
                : { store, dirty: new Set<MessageKey>(), cleared: undefined, writing: undefined };
        queueRef.current = queue;

        const write = async () => {
            while (queue.cleared !== undefined || queue.dirty.size > 0) {
                if (queue.cleared !== undefined) {
                    const dropped = queue.cleared;
                    queue.cleared = undefined;
                    queue.dirty.clear();
                    await clearHistory(dropped);
                    continue;
                }
                const batch = [...queue.dirty];
                queue.dirty.clear();
                const upserts: Array<ChatEventRecord> = [];
                for (const key of batch) {
                    const record = store.getRecord(key);
                    if (record !== undefined) upserts.push(record);
                }
                await saveHistory(upserts);
            }
        };

        /** Re-checks after releasing the slot: work queued while the pass was settling would otherwise be stranded. */
        const drain = (): Promise<void> => {
            const running = queue.writing;
            if (running !== undefined) return running;
            const started: Promise<void> = write()
                .catch(console.error)
                .then(() => {
                    if (queue.writing === started) queue.writing = undefined;
                    if (queue.cleared === undefined && queue.dirty.size === 0) return undefined;
                    return drain();
                });
            queue.writing = started;
            started.catch(console.error);
            return started;
        };

        if (queue.cleared !== undefined || queue.dirty.size > 0) void drain();

        return store.subscribeMutations((mutations) => {
            for (const mutation of mutations) {
                switch (mutation.kind) {
                    /** A re-read makes nothing dirty, but a clear the user already asked for still has to land. */
                    case 'reset':
                        queue.dirty.clear();
                        break;
                    case 'clearAll':
                        queue.dirty.clear();
                        queue.cleared = mutation.records;
                        break;
                    case 'upsert':
                        queue.dirty.add(mutation.key);
                        break;
                }
            }
            void drain();
        });
    }, [store, saveHistory, clearHistory]);

    const displayTyping = useCallback(
        (show: boolean) => {
            store.setTyping(show);
            clearTimeout(typingTimeoutRef.current);
            if (show) {
                typingTimeoutRef.current = setTimeout(() => store.setTyping(false), TYPING_TIMEOUT);
            }
        },
        [store],
    );

    const displayRecord = useCallback(
        (record: ChatEventRecord) => {
            const held = store.getMessage(record.id) !== undefined;
            store.apply(record);
            if (!isChatMessageRecord(record)) return;
            if (held) return;
            if (record.sender === 'peer' && !notifiedRef.current.has(record.id)) {
                notifiedRef.current.add(record.id);
                if (document.hidden) {
                    showNotification('New message!', { body: record.text });
                }
            }
        },
        [store],
    );

    const sendOperation = useCallback((operation: ChatOperation) => sendMessage(operation), [sendMessage]);

    const sendAction = useCallback(
        async (action: ActionType) => {
            const at = Date.now();
            if (typingSendPendingRef.current || at - lastTypingSentAtRef.current < TYPING_SEND_INTERVAL) return;
            typingSendPendingRef.current = true;
            lastTypingSentAtRef.current = at;
            try {
                await sendOperation({ kind: action });
            } finally {
                typingSendPendingRef.current = false;
            }
        },
        [sendOperation],
    );

    const sendText = useCallback(
        async (input: string) => {
            const target = store.getReplyTo();
            const record = await sendOperation({
                kind: 'text',
                text: input,
                replyTo: target === undefined ? undefined : { id: target.id, sender: target.sender, text: target.text },
            });
            if (record === undefined) return;
            displayRecord(record);
            store.setReplyTo(undefined);
            setOrder(record.timestamp);
        },
        [store, sendOperation, displayRecord, setOrder],
    );

    const sendAndApply = useCallback(
        async (operation: ChatOperation): Promise<void> => {
            const record = await sendOperation(operation);
            if (record !== undefined) store.apply(record);
        },
        [sendOperation, store],
    );

    const sendDelivered = useCallback((id: EventId) => sendAndApply({ kind: 'delivered', target: id }), [sendAndApply]);

    const sendSeen = useCallback((id: EventId) => sendAndApply({ kind: 'seen', target: id }), [sendAndApply]);

    const sendReaction = useCallback(
        (id: EventId, reaction: string) => sendAndApply({ kind: 'reaction', target: id, value: reaction }),
        [sendAndApply],
    );

    const synchronize = useCallback(async () => {
        if (anonymous === true) return;
        await sendOperation({ kind: 'sync', records: store.getRecords() });
    }, [anonymous, sendOperation, store]);

    const setReplyTo = useCallback(
        (id: EventId, sender: 'you' | 'peer', text: string, scrollToReply: () => void) => {
            const current = store.getReplyTo();
            if (current?.id === id && current.sender === sender) return;
            store.setReplyTo({
                id,
                sender,
                text,
                scrollToReply,
            } satisfies ReplyTarget);
        },
        [store],
    );

    const resetReplyTo = useCallback(() => store.setReplyTo(undefined), [store]);

    const clear = useCallback(async () => {
        notifiedRef.current.clear();
        store.clear();
        await queueRef.current?.writing;
    }, [store]);

    const onStateChanged = useCallback(
        (_: ConnectionState, to: ConnectionState) => {
            if (to === ConnectionState.Open || to === ConnectionState.Degraded) {
                /** An anonymous member sends nothing, so the slot stays unclaimed until it can actually sync. */
                if (anonymous === true || hasBeenOpenedRef.current) return;
                hasBeenOpenedRef.current = true;
                synchronize().catch(console.error);
            } else if (to === ConnectionState.Closed) {
                displayTyping(false);
                notifiedRef.current.clear();
                hasBeenOpenedRef.current = false;
            }
        },
        [anonymous, synchronize, displayTyping],
    );

    const onEvent = useCallback(
        (event: InboundChatEvent) => {
            if (event.kind === 'typing') {
                displayTyping(true);
                return;
            }
            const record = event.record;
            if (!isChatMessageRecord(record)) {
                displayRecord(record);
                return;
            }
            displayTyping(false);
            displayRecord(record);
            if (record.sender === 'peer') {
                if (anonymous === true) {
                    if (withheldRef.current.size >= WITHHELD_RECEIPT_LIMIT) {
                        withheldRef.current.delete(withheldRef.current.values().next().value as EventId);
                    }
                    withheldRef.current.add(record.id);
                } else sendDelivered(record.id).catch(console.error);
                setOrder(record.timestamp);
            }
        },
        [anonymous, displayTyping, displayRecord, sendDelivered, setOrder],
    );

    useEffect(() => {
        if (anonymous === true || withheldRef.current.size === 0) return;
        const withheld = [...withheldRef.current];
        withheldRef.current.clear();
        for (const id of withheld) sendDelivered(id).catch(console.error);
    }, [anonymous, sendDelivered]);

    useEffect(() => setOnStateChanged(onStateChanged), [setOnStateChanged, onStateChanged]);
    useEffect(() => setOnEvent(onEvent), [setOnEvent, onEvent]);

    useEffect(() => () => clearTimeout(typingTimeoutRef.current), []);

    return useMemo(
        () => ({
            store,
            send: {
                action: sendAction,
                text: sendText,
                reaction: sendReaction,
                seen: sendSeen,
            },
            replyTo: { set: setReplyTo, reset: resetReplyTo },
            clear,
        }),
        [store, sendAction, sendText, sendReaction, sendSeen, setReplyTo, resetReplyTo, clear],
    );
}
