import { ChatStore, getChatStore, MessageKey, ReplyTarget } from '../lib/chatStore';
import { setUnreadCount } from '../lib/connectionStore';
import { subscribeHistoryChange } from '../lib/tabSync';
import { ActionType } from '../types/actionType';
import { ChatWindowMessageType } from '../types/chatMessageType';
import { ChatOperation, InboundChatEvent } from '../types/chatOperation';
import { ChatEventRecord, ChatMessageRecord, isChatMessageRecord } from '../types/chatRecord';
import { ConversationId } from '../types/conversation';
import { EventId } from '../types/eventId';
import { serverTime, showNotification } from '../utils/functions';
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
    ownMemberNumber?: number;
    callbacks: ConnectionCallbacks;
};

const TYPING_TIMEOUT = 5 * 1000;
const TYPING_SEND_INTERVAL = 2 * 1000;

export function useChat({ conversationId, ownMemberNumber, callbacks }: ChatHookProps): ChatHook {
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

    useEffect(
        () =>
            subscribeHistoryChange((change) => {
                if (change.id !== conversationId) return;
                if (change.cleared) store.clear();
                getHistory()
                    .then((history) => store.hydrate(history))
                    .catch(console.error);
            }),
        [conversationId, getHistory, store],
    );

    useEffect(() => {
        const seenHere = (message: ChatWindowMessageType): boolean =>
            ownMemberNumber === undefined
                ? message.seen !== undefined
                : (message.seenBy ?? []).some((entry) => Number(entry.author) === Number(ownMemberNumber));
        const recount = () => {
            const messages = store.getMessages();
            setUnreadCount(
                conversationId,
                messages.filter((message) => message.sender === 'peer' && !seenHere(message)).length,
            );
        };
        recount();
        return store.subscribeAny(recount);
    }, [store, conversationId, ownMemberNumber]);

    useEffect(() => {
        const dirty = new Map<MessageKey, 'upsert' | 'delete'>();
        let cleared: ReadonlyArray<ChatEventRecord> | undefined;
        let writing = false;

        const drain = async () => {
            if (writing) return;
            writing = true;
            try {
                while (cleared !== undefined || dirty.size > 0) {
                    if (cleared !== undefined) {
                        const dropped = cleared;
                        cleared = undefined;
                        dirty.clear();
                        await clearHistory(dropped);
                        continue;
                    }
                    const batch = [...dirty.entries()];
                    dirty.clear();
                    const upserts: Array<ChatEventRecord> = [];
                    const deletes: Array<MessageKey> = [];
                    for (const [key, operation] of batch) {
                        if (operation === 'delete') {
                            deletes.push(key);
                            continue;
                        }
                        const record = store.getRecord(key);
                        if (record !== undefined) upserts.push(record);
                    }
                    await saveHistory(upserts, deletes);
                }
            } catch (error) {
                console.error(error);
            } finally {
                writing = false;
            }
        };

        return store.subscribeMutations((mutations) => {
            for (const mutation of mutations) {
                switch (mutation.kind) {
                    case 'reset':
                        dirty.clear();
                        cleared = undefined;
                        break;
                    case 'clearAll':
                        dirty.clear();
                        cleared = mutation.records;
                        break;
                    case 'upsert':
                        dirty.set(mutation.key, 'upsert');
                        break;
                    case 'delete':
                        dirty.set(mutation.key, 'delete');
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
            const replyTo = store.getReplyTo();
            const record = await sendOperation({
                kind: 'text',
                text: input,
                replyTo,
            });
            if (record === undefined) return;
            displayRecord(record);
            store.setReplyTo(undefined);
            setOrder(record.timestamp);
        },
        [store, sendOperation, displayRecord, setOrder],
    );

    const sendDelivered = useCallback(
        async (id: EventId) => {
            const record = await sendOperation({ kind: 'delivered', target: id });
            if (record !== undefined) store.apply(record);
        },
        [sendOperation, store],
    );

    const sendSeen = useCallback(
        async (id: EventId) => {
            const record = await sendOperation({ kind: 'seen', target: id });
            if (record !== undefined) store.apply(record);
        },
        [sendOperation, store],
    );

    const sendReaction = useCallback(
        async (id: EventId, value: string) => {
            const record = await sendOperation({
                kind: 'reaction',
                target: id,
                value,
            });
            if (record !== undefined) store.apply(record);
        },
        [sendOperation, store],
    );

    const synchronize = useCallback(async () => {
        await sendOperation({ kind: 'sync', records: store.getRecords() });
    }, [sendOperation, store]);

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
    }, [store]);

    const onStateChanged = useCallback(
        (_: ConnectionState, to: ConnectionState) => {
            if (to === ConnectionState.Open || to === ConnectionState.Degraded) {
                if (hasBeenOpenedRef.current) return;
                hasBeenOpenedRef.current = true;
                synchronize().catch(console.error);
            } else if (to === ConnectionState.Closed) {
                displayTyping(false);
                notifiedRef.current.clear();
                hasBeenOpenedRef.current = false;
            }
        },
        [synchronize, displayTyping],
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
                sendDelivered(record.id).catch(console.error);
                setOrder(record.timestamp);
            }
        },
        [displayTyping, displayRecord, sendDelivered, setOrder],
    );

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
