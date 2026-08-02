import { ChatWindowMessageType } from '../types/chatMessageType';
import { ReplyToMessageType } from '../types/replyToMessageType';
import { now, serverTime } from '../utils/functions';
import { fmtDay } from './time';
import { useSyncExternalStore } from 'react';

export type MessageSender = 'you' | 'peer';

export type MessageKey = string;

export type ReplyTarget = ReplyToMessageType & { scrollToReply: () => void };

export type ChatMutation =
    | { kind: 'upsert'; key: MessageKey }
    | { kind: 'delete'; key: MessageKey }
    | { kind: 'clearAll' }
    | { kind: 'reset' };

export type ChatMutationListener = (mutations: ReadonlyArray<ChatMutation>) => void;

export function messageKey(id: number, sender: ChatWindowMessageType['sender']): MessageKey {
    return `${sender}:${id}`;
}

function rankOf(sender: ChatWindowMessageType['sender']): number {
    switch (sender) {
        case 'date':
            return 0;
        case 'you':
            return 1;
        case 'peer':
            return 2;
    }
}

function sortValue(message: ChatWindowMessageType): number {
    return message.timestamp * 10 + rankOf(message.sender);
}

function earliest(
    a: { timestamp: number } | undefined,
    b: { timestamp: number } | undefined,
): { timestamp: number } | undefined {
    if (a === undefined) return b;
    if (b === undefined) return a;
    return a.timestamp <= b.timestamp ? a : b;
}

function mergeMessage(live: ChatWindowMessageType, stored: ChatWindowMessageType): ChatWindowMessageType {
    const reaction =
        live.reaction === undefined ||
        (stored.reaction !== undefined && stored.reaction.timestamp > live.reaction.timestamp)
            ? stored.reaction
            : live.reaction;
    return {
        ...live,
        delivered: earliest(live.delivered, stored.delivered),
        seen: earliest(live.seen, stored.seen),
        reaction: reaction ?? live.reaction,
        reply_to: live.reply_to ?? stored.reply_to,
    };
}

function sameMessage(a: ChatWindowMessageType, b: ChatWindowMessageType): boolean {
    return (
        a.text === b.text &&
        a.timestamp === b.timestamp &&
        a.delivered?.timestamp === b.delivered?.timestamp &&
        a.seen?.timestamp === b.seen?.timestamp &&
        a.reaction?.timestamp === b.reaction?.timestamp &&
        a.reaction?.value === b.reaction?.value &&
        a.reply_to?.id === b.reply_to?.id &&
        a.reply_to?.sender === b.reply_to?.sender &&
        a.reply_to?.text === b.reply_to?.text
    );
}

export type ChatStore = {
    subscribeKeys(listener: () => void): () => void;
    getKeys(): ReadonlyArray<MessageKey>;

    subscribeMessage(key: MessageKey, listener: () => void): () => void;
    getMessage(key: MessageKey): ChatWindowMessageType | undefined;

    subscribeTyping(listener: () => void): () => void;
    getTyping(): boolean;

    subscribeHighlight(key: MessageKey, listener: () => void): () => void;
    isHighlighted(key: MessageKey): boolean;
    setHighlight(key: MessageKey | undefined): void;

    subscribeReplyTo(listener: () => void): () => void;
    getReplyTo(): ReplyTarget | undefined;

    subscribeAny(listener: () => void): () => void;

    subscribeMutations(listener: ChatMutationListener): () => void;

    getMessages(): ReadonlyArray<ChatWindowMessageType>;

    hydrate(messages: ReadonlyArray<ChatWindowMessageType>): void;
    add(message: ChatWindowMessageType): void;
    patch(id: number, sender: MessageSender, updater: (message: ChatWindowMessageType) => ChatWindowMessageType): void;
    clear(): void;

    setTyping(typing: boolean): void;
    setReplyTo(target: ReplyTarget | undefined): void;
};

function createChatStore(): ChatStore {
    const messages = new Map<MessageKey, ChatWindowMessageType>();
    const separators = new Map<MessageKey, ChatWindowMessageType>();

    let orderedKeys: ReadonlyArray<MessageKey> = [];
    let messageList: ReadonlyArray<ChatWindowMessageType> = [];
    let typing = false;
    let replyTo: ReplyTarget | undefined;
    let highlighted: MessageKey | undefined;

    const keyListeners = new Set<() => void>();
    const anyListeners = new Set<() => void>();
    const mutationListeners = new Set<ChatMutationListener>();
    const typingListeners = new Set<() => void>();
    const replyListeners = new Set<() => void>();
    const messageListeners = new Map<MessageKey, Set<() => void>>();
    const highlightListeners = new Map<MessageKey, Set<() => void>>();

    function notify(listeners: Set<() => void>): void {
        for (const listener of listeners) {
            listener();
        }
    }

    function notifyMessage(key: MessageKey): void {
        const listeners = messageListeners.get(key);
        if (listeners !== undefined) notify(listeners);
    }

    function emit(mutations: ReadonlyArray<ChatMutation>): void {
        for (const listener of mutationListeners) {
            listener(mutations);
        }
    }

    function reindex(): void {
        const sorted = [...messages.values()].sort((a, b) => sortValue(a) - sortValue(b));
        messageList = sorted;

        const keys: MessageKey[] = [];
        const seen = new Set<MessageKey>();
        const delta = now() - serverTime();
        let lastDay: number | undefined;

        const separatorFor = (timestamp: number): void => {
            const localDay = new Date(timestamp + delta).setHours(0, 0, 0, 0);
            if (lastDay === localDay) return;
            lastDay = localDay;
            const at = localDay - delta;
            const key = messageKey(at, 'date');
            const text = fmtDay(localDay);
            const existing = separators.get(key);
            if (existing === undefined || existing.text !== text) {
                separators.set(key, { id: at, timestamp: at, sender: 'date', text });
            }
            keys.push(key);
            seen.add(key);
        };

        for (const message of sorted) {
            separatorFor(message.timestamp);
            keys.push(messageKey(message.id, message.sender));
        }
        separatorFor(now());

        for (const key of [...separators.keys()]) {
            if (!seen.has(key)) separators.delete(key);
        }

        const changed = keys.length !== orderedKeys.length || keys.some((key, index) => key !== orderedKeys[index]);
        if (changed) {
            orderedKeys = keys;
            notify(keyListeners);
        }
        notify(anyListeners);
    }

    return {
        subscribeKeys(listener) {
            keyListeners.add(listener);
            return () => keyListeners.delete(listener) as unknown as void;
        },
        getKeys: () => orderedKeys,

        subscribeMessage(key, listener) {
            let listeners = messageListeners.get(key);
            if (listeners === undefined) {
                listeners = new Set();
                messageListeners.set(key, listeners);
            }
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) messageListeners.delete(key);
            };
        },
        getMessage: (key) => messages.get(key) ?? separators.get(key),

        subscribeTyping(listener) {
            typingListeners.add(listener);
            return () => typingListeners.delete(listener) as unknown as void;
        },
        getTyping: () => typing,

        subscribeHighlight(key, listener) {
            let listeners = highlightListeners.get(key);
            if (listeners === undefined) {
                listeners = new Set();
                highlightListeners.set(key, listeners);
            }
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) highlightListeners.delete(key);
            };
        },
        isHighlighted: (key) => highlighted === key,
        setHighlight(next) {
            if (highlighted === next) return;
            const previous = highlighted;
            highlighted = next;
            for (const key of [previous, next]) {
                if (key === undefined) continue;
                const listeners = highlightListeners.get(key);
                if (listeners !== undefined) notify(listeners);
            }
        },

        subscribeReplyTo(listener) {
            replyListeners.add(listener);
            return () => replyListeners.delete(listener) as unknown as void;
        },
        getReplyTo: () => replyTo,

        subscribeAny(listener) {
            anyListeners.add(listener);
            return () => anyListeners.delete(listener) as unknown as void;
        },

        subscribeMutations(listener) {
            mutationListeners.add(listener);
            return () => mutationListeners.delete(listener) as unknown as void;
        },
        getMessages: () => messageList,

        hydrate(next) {
            const live = [...messages.keys()];
            const changed: MessageKey[] = [];
            for (const message of next) {
                if (message.sender === 'date') continue;
                const key = messageKey(message.id, message.sender);
                const existing = messages.get(key);
                if (existing === undefined) {
                    messages.set(key, message);
                    changed.push(key);
                    continue;
                }
                const merged = mergeMessage(existing, message);
                if (sameMessage(existing, merged)) continue;
                messages.set(key, merged);
                changed.push(key);
            }
            reindex();
            for (const key of changed) {
                notifyMessage(key);
            }
            emit([{ kind: 'reset' }, ...live.map((key) => ({ kind: 'upsert', key }) as const)]);
        },

        add(message) {
            if (message.sender === 'date') return;
            const key = messageKey(message.id, message.sender);
            if (messages.has(key)) return;
            messages.set(key, message);
            reindex();
            notifyMessage(key);
            emit([{ kind: 'upsert', key }]);
        },

        patch(id, sender, updater) {
            const key = messageKey(id, sender);
            const current = messages.get(key);
            if (current === undefined) return;
            const next = updater(current);
            if (next === current || sameMessage(current, next)) return;
            messages.set(key, next);
            const index = messageList.indexOf(current);
            if (index >= 0) {
                const updated = messageList.slice();
                updated[index] = next;
                messageList = updated;
            }
            notifyMessage(key);
            notify(anyListeners);
            emit([{ kind: 'upsert', key }]);
        },

        clear() {
            const keys = [...messages.keys()];
            messages.clear();
            reindex();
            for (const key of keys) {
                notifyMessage(key);
            }
            emit([{ kind: 'clearAll' }]);
        },

        setTyping(next) {
            if (typing === next) return;
            typing = next;
            notify(typingListeners);
        },

        setReplyTo(next) {
            if (replyTo === next) return;
            replyTo = next;
            notify(replyListeners);
        },
    };
}

const stores = new Map<string, ChatStore>();

export function getChatStore(publicKey: string): ChatStore {
    let store = stores.get(publicKey);
    if (store === undefined) {
        store = createChatStore();
        stores.set(publicKey, store);
    }
    return store;
}

export function disposeChatStore(publicKey: string): void {
    stores.delete(publicKey);
}

export function useMessageKeys(store: ChatStore): ReadonlyArray<MessageKey> {
    return useSyncExternalStore(store.subscribeKeys, store.getKeys);
}

export function useMessage(store: ChatStore, key: MessageKey): ChatWindowMessageType | undefined {
    return useSyncExternalStore(
        (listener) => store.subscribeMessage(key, listener),
        () => store.getMessage(key),
    );
}

export function useTyping(store: ChatStore): boolean {
    return useSyncExternalStore(store.subscribeTyping, store.getTyping);
}

export function useHighlighted(store: ChatStore, key: MessageKey): boolean {
    return useSyncExternalStore(
        (listener) => store.subscribeHighlight(key, listener),
        () => store.isHighlighted(key),
    );
}

export function useReplyTo(store: ChatStore): ReplyTarget | undefined {
    return useSyncExternalStore(store.subscribeReplyTo, store.getReplyTo);
}
