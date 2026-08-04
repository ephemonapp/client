import { ChatStore, getChatStore, MessageKey, ReplyTarget } from '../lib/chatStore';
import { setUnreadCount } from '../lib/connectionStore';
import { buildReplay, flipReplyTo } from '../lib/replay';
import { ActionType } from '../types/actionType';
import { ChatWindowMessageType } from '../types/chatMessageType';
import { ConversationId } from '../types/conversation';
import { DeliveredType } from '../types/deliveredType';
import { MessageType } from '../types/messageType';
import { ReactionType } from '../types/reactionType';
import { SeenType } from '../types/seenType';
import { UpdateType } from '../types/updateType';
import { serverTime, showNotification } from '../utils/functions';
import { ConnectionCallbacks } from './useConnectionCallbacksCache';
import { ConnectionState } from '@ephemon/core';
import { useCallback, useEffect, useMemo, useRef } from 'react';

export type ChatHook = {
    store: ChatStore;
    send: {
        action: (type: 'typing') => Promise<void>;
        text: (input: string) => Promise<void>;
        reaction: (id: number, reaction: string) => Promise<void>;
        seen: (id: number) => Promise<void>;
    };
    replyTo: {
        set: (id: number, sender: 'you' | 'peer', text: string, scrollToReply: () => void) => void;
        reset: () => void;
    };
    clear: () => Promise<void>;
};

type ChatHookProps = {
    conversationId: ConversationId;
    callbacks: ConnectionCallbacks;
};

const TYPING_TIMEOUT = 5 * 1000;
const TYPING_SEND_INTERVAL = 2 * 1000;

export function useChat({ conversationId, callbacks }: ChatHookProps): ChatHook {
    const {
        view: { setOrder },
        messaging: {
            send: sendMessage,
            history: { get: getHistory, save: saveHistory, clear: clearHistory },
        },
        events: { setOnStateChanged, setOnMessage },
    } = callbacks;

    const store = useMemo(() => getChatStore(conversationId), [conversationId]);

    const notifiedRef = useRef<Set<number>>(new Set());
    const hasBeenOpenedRef = useRef(false);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const lastTypingSentAtRef = useRef(Number.NEGATIVE_INFINITY);
    const typingSendPendingRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        getHistory()
            .then((history) => {
                if (cancelled) return;
                for (const message of history) {
                    notifiedRef.current.add(message.id);
                }
                store.hydrate(history);
            })
            .catch(console.error);
        return () => {
            cancelled = true;
        };
    }, [store, getHistory]);

    useEffect(() => {
        const recount = () => {
            const messages = store.getMessages();
            setUnreadCount(
                conversationId,
                messages.filter((message) => message.sender === 'peer' && message.seen === undefined).length,
            );
        };
        recount();
        return store.subscribeAny(recount);
    }, [store, conversationId]);

    useEffect(() => {
        const dirty = new Map<MessageKey, 'upsert' | 'delete'>();
        let clearPending = false;
        let writing = false;

        const drain = async () => {
            if (writing) return;
            writing = true;
            try {
                while (clearPending || dirty.size > 0) {
                    if (clearPending) {
                        clearPending = false;
                        dirty.clear();
                        await clearHistory();
                        continue;
                    }
                    const batch = [...dirty.entries()];
                    dirty.clear();
                    const upserts: Array<ChatWindowMessageType> = [];
                    const deletes: Array<MessageKey> = [];
                    for (const [key, operation] of batch) {
                        if (operation === 'delete') {
                            deletes.push(key);
                            continue;
                        }
                        const message = store.getMessage(key);
                        if (message !== undefined && message.sender !== 'date') upserts.push(message);
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
                        clearPending = false;
                        break;
                    case 'clearAll':
                        dirty.clear();
                        clearPending = true;
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

    const displayMessage = useCallback(
        (id: number, sender: 'you' | 'peer', message: MessageType) => {
            store.add({ id, sender, ...message });
            if (sender === 'peer' && !notifiedRef.current.has(id)) {
                notifiedRef.current.add(id);
                if (document.hidden) {
                    showNotification('New message!', { body: message.text });
                }
            }
        },
        [store],
    );

    const sendUpdate = useCallback(
        async (update: UpdateType, options?: { ephemeral?: boolean }) => {
            await sendMessage(JSON.stringify(update), options);
        },
        [sendMessage],
    );

    const sendAction = useCallback(
        async (action: ActionType) => {
            const at = Date.now();
            if (typingSendPendingRef.current || at - lastTypingSentAtRef.current < TYPING_SEND_INTERVAL) return;
            typingSendPendingRef.current = true;
            lastTypingSentAtRef.current = at;
            try {
                await sendUpdate({ id: serverTime(), action }, { ephemeral: true });
            } finally {
                typingSendPendingRef.current = false;
            }
        },
        [sendUpdate],
    );

    const sendText = useCallback(
        async (input: string) => {
            const at = serverTime();
            const replyTo = store.getReplyTo();
            await sendUpdate({
                id: at,
                message: { timestamp: at, text: input, reply_to: flipReplyTo(replyTo) },
            });
            displayMessage(at, 'you', { timestamp: at, text: input, reply_to: replyTo });
            store.setReplyTo(undefined);
            setOrder(at);
        },
        [store, sendUpdate, displayMessage, setOrder],
    );

    const setMessageDelivered = useCallback(
        (id: number, delivered: DeliveredType, sender: 'you' | 'peer') => {
            store.patch(id, sender, (message) => ({
                ...message,
                delivered: {
                    ...delivered,
                    timestamp: Math.min(message.delivered?.timestamp ?? delivered.timestamp, delivered.timestamp),
                },
            }));
        },
        [store],
    );

    const setMessageSeen = useCallback(
        (id: number, seen: SeenType, sender: 'you' | 'peer') => {
            store.patch(id, sender, (message) => ({
                ...message,
                seen: { ...seen, timestamp: Math.min(message.seen?.timestamp ?? seen.timestamp, seen.timestamp) },
            }));
        },
        [store],
    );

    const setMessageReaction = useCallback(
        (id: number, sender: 'you' | 'peer', reaction: ReactionType) => {
            store.patch(id, sender, (message) =>
                message.reaction != null && reaction.timestamp <= message.reaction.timestamp
                    ? message
                    : { ...message, reaction },
            );
        },
        [store],
    );

    const sendDelivered = useCallback(
        async (id: number) => {
            const at = serverTime();
            setMessageDelivered(id, { timestamp: at }, 'peer');
            await sendUpdate({ id, delivered: { timestamp: at } });
        },
        [sendUpdate, setMessageDelivered],
    );

    const sendSeen = useCallback(
        async (id: number) => {
            const at = serverTime();
            setMessageSeen(id, { timestamp: at }, 'peer');
            await sendUpdate({ id, seen: { timestamp: at } });
        },
        [sendUpdate, setMessageSeen],
    );

    const sendReaction = useCallback(
        async (id: number, value: string) => {
            const at = serverTime();
            await sendUpdate({ id, reaction: { timestamp: at, value } });
            setMessageReaction(id, 'peer', { timestamp: at, value });
        },
        [sendUpdate, setMessageReaction],
    );

    const resendCached = useCallback(async () => {
        await sendUpdate({ id: serverTime(), history: buildReplay(store.getMessages()) });
    }, [sendUpdate, store]);

    const setReplyTo = useCallback(
        (id: number, sender: 'you' | 'peer', text: string, scrollToReply: () => void) => {
            const current = store.getReplyTo();
            if (current?.id === id && current.sender === sender) return;
            store.setReplyTo({ id, sender, text, scrollToReply } satisfies ReplyTarget);
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
                resendCached().catch(console.error);
            } else if (to === ConnectionState.Closed) {
                displayTyping(false);
                notifiedRef.current.clear();
                hasBeenOpenedRef.current = false;
            }
        },
        [resendCached, displayTyping],
    );

    const onUpdate = useCallback(
        (update: UpdateType) => {
            if (update.action === 'typing') displayTyping(true);
            if (update.message != null) {
                displayTyping(false);
                displayMessage(update.id, 'peer', update.message);
                sendDelivered(update.id).catch(console.error);
                setOrder(update.id);
            }
            if (update.delivered != null) setMessageDelivered(update.id, update.delivered, 'you');
            if (update.seen != null) setMessageSeen(update.id, update.seen, 'you');
            if (update.reaction != null) setMessageReaction(update.id, 'you', update.reaction);
            if (update.history != null) {
                for (const historical of update.history) onUpdate(historical);
            }
        },
        [
            displayTyping,
            displayMessage,
            sendDelivered,
            setOrder,
            setMessageDelivered,
            setMessageSeen,
            setMessageReaction,
        ],
    );

    const onMessage = useCallback((value: string) => onUpdate(JSON.parse(value) as UpdateType), [onUpdate]);

    useEffect(() => setOnStateChanged(onStateChanged), [setOnStateChanged, onStateChanged]);
    useEffect(() => setOnMessage(onMessage), [setOnMessage, onMessage]);

    useEffect(() => () => clearTimeout(typingTimeoutRef.current), []);

    return useMemo(
        () => ({
            store,
            send: { action: sendAction, text: sendText, reaction: sendReaction, seen: sendSeen },
            replyTo: { set: setReplyTo, reset: resetReplyTo },
            clear,
        }),
        [store, sendAction, sendText, sendReaction, sendSeen, setReplyTo, resetReplyTo, clear],
    );
}
