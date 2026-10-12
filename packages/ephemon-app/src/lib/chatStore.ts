import { compareHybridLogicalTime, HybridLogicalTime } from '../mls/hybridLogicalClock';
import { ChatWindowMessageType, MemberReaction, MemberReceipt } from '../types/chatMessageType';
import { ChatEventRecord, ChatReceiptRecord, isChatMessageRecord } from '../types/chatRecord';
import { ConversationId, MemberNumber } from '../types/conversation';
import { EventId, toDateSeparatorId } from '../types/eventId';
import { ReplyToMessageType } from '../types/replyToMessageType';
import { serverTime } from '../utils/functions';
import { fmtDay } from './time';
import { useSyncExternalStore } from 'react';

export type MessageKey = EventId;

export type ReplyTarget = ReplyToMessageType & { scrollToReply: () => void };

export type ChatMutation =
    | { kind: 'upsert'; key: MessageKey }
    | { kind: 'clearAll'; records: ReadonlyArray<ChatEventRecord> }
    | { kind: 'reset' };

export type ChatMutationListener = (mutations: ReadonlyArray<ChatMutation>) => void;

function directionRank(sender: ChatWindowMessageType['sender']): number {
    return sender === 'you' ? 0 : 1;
}

function compareMessages(a: ChatWindowMessageType, b: ChatWindowMessageType): number {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    if ((a.counter ?? 0) !== (b.counter ?? 0)) return (a.counter ?? 0) - (b.counter ?? 0);
    if (a.author === undefined && b.author === undefined) {
        if (directionRank(a.sender) !== directionRank(b.sender)) {
            return directionRank(a.sender) - directionRank(b.sender);
        }
    } else if ((a.author ?? -1) !== (b.author ?? -1)) {
        return (a.author ?? -1) - (b.author ?? -1);
    }
    if ((a.sequence ?? -1) !== (b.sequence ?? -1)) return (a.sequence ?? -1) - (b.sequence ?? -1);
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
}

/** Receipts whose target never arrives are held for reordering, not forever. */
const MAX_ORPHAN_TARGETS = 256;

const NO_MEMBER = -1 as MemberNumber;

function withReceipt(
    existing: ReadonlyArray<MemberReceipt> | undefined,
    author: MemberNumber,
    timestamp: number,
): ReadonlyArray<MemberReceipt> {
    const rest = (existing ?? []).filter((entry) => Number(entry.author) !== Number(author));
    const previous = (existing ?? []).find((entry) => Number(entry.author) === Number(author));
    return [...rest, { author, timestamp: Math.min(previous?.timestamp ?? timestamp, timestamp) }].sort(
        (left, right) => Number(left.author) - Number(right.author),
    );
}

function withReaction(
    existing: ReadonlyArray<MemberReaction> | undefined,
    author: MemberNumber,
    value: string,
    timestamp: number,
): ReadonlyArray<MemberReaction> {
    const byAuthor = new Map<number, { value: string; timestamp: number }>();
    for (const reaction of existing ?? []) {
        for (const member of reaction.authors) {
            byAuthor.set(Number(member), { value: reaction.value, timestamp: reaction.timestamp });
        }
    }
    /**
     * Catch-up and relay deliver events out of order, so an older pick must not undo a member's newer one. A cleared
     * reaction is kept as an empty entry rather than dropped: it is the only record that the clearing happened, and
     * without it a replayed older pick brings the reaction back.
     */
    const held = byAuthor.get(Number(author));
    if (held !== undefined && held.timestamp > timestamp) return existing ?? [];
    byAuthor.set(Number(author), { value, timestamp });
    const grouped = new Map<string, { authors: Array<MemberNumber>; timestamp: number }>();
    for (const [member, reaction] of byAuthor) {
        const entry = grouped.get(reaction.value) ?? { authors: [], timestamp: reaction.timestamp };
        entry.authors.push(member as MemberNumber);
        entry.timestamp = Math.min(entry.timestamp, reaction.timestamp);
        grouped.set(reaction.value, entry);
    }
    return [...grouped.entries()]
        .map(([value, entry]) => ({
            value,
            authors: entry.authors.sort((left, right) => Number(left) - Number(right)),
            timestamp: entry.timestamp,
        }))
        .sort((left, right) => left.timestamp - right.timestamp);
}

function newest(reactions: ReadonlyArray<MemberReaction>): { timestamp: number; value: string } | undefined {
    const last = reactions
        .filter((reaction) => reaction.value.length > 0)
        .sort((left, right) => left.timestamp - right.timestamp)
        .pop();
    return last === undefined ? undefined : { timestamp: last.timestamp, value: last.value };
}

function applyReceipt(message: ChatWindowMessageType, receipt: ChatReceiptRecord): ChatWindowMessageType {
    const author = receipt.author ?? NO_MEMBER;
    switch (receipt.kind) {
        case 'delivered': {
            const deliveredBy = withReceipt(message.deliveredBy, author, receipt.timestamp);
            return {
                ...message,
                deliveredBy,
                delivered: { timestamp: Math.min(...deliveredBy.map((entry) => entry.timestamp)) },
            };
        }
        case 'seen': {
            const seenBy = withReceipt(message.seenBy, author, receipt.timestamp);
            return {
                ...message,
                seenBy,
                seen: { timestamp: Math.min(...seenBy.map((entry) => entry.timestamp)) },
            };
        }
        case 'reaction': {
            const reactions = withReaction(message.reactions, author, receipt.value ?? '', receipt.timestamp);
            return { ...message, reactions, reaction: newest(reactions) };
        }
    }
}

function receiptKey(entries: ReadonlyArray<MemberReceipt> | undefined): string {
    return (entries ?? []).map((entry) => `${Number(entry.author)}:${entry.timestamp}`).join(',');
}

function reactionKey(entries: ReadonlyArray<MemberReaction> | undefined): string {
    return (entries ?? []).map((entry) => `${entry.value}:${entry.authors.map(Number).join('+')}`).join(',');
}

function sameMessage(a: ChatWindowMessageType, b: ChatWindowMessageType): boolean {
    return (
        a.text === b.text &&
        a.timestamp === b.timestamp &&
        a.delivered?.timestamp === b.delivered?.timestamp &&
        a.seen?.timestamp === b.seen?.timestamp &&
        a.reaction?.timestamp === b.reaction?.timestamp &&
        a.reaction?.value === b.reaction?.value &&
        receiptKey(a.deliveredBy) === receiptKey(b.deliveredBy) &&
        receiptKey(a.seenBy) === receiptKey(b.seenBy) &&
        reactionKey(a.reactions) === reactionKey(b.reactions) &&
        a.reply_to?.id === b.reply_to?.id &&
        a.reply_to?.sender === b.reply_to?.sender &&
        a.reply_to?.text === b.reply_to?.text
    );
}

export function hasSeen(message: ChatWindowMessageType, ownMemberNumber: number | undefined): boolean {
    if (ownMemberNumber === undefined) return message.seen !== undefined;
    return (message.seenBy ?? []).some((entry) => Number(entry.author) === Number(ownMemberNumber));
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

    getRecord(key: MessageKey): ChatEventRecord | undefined;
    getRecords(): ReadonlyArray<ChatEventRecord>;

    getObservedTime(): HybridLogicalTime | undefined;

    hydrate(records: ReadonlyArray<ChatEventRecord>): void;
    apply(record: ChatEventRecord): void;
    clear(): void;

    setTyping(typing: boolean): void;
    setReplyTo(target: ReplyTarget | undefined): void;
};

function createChatStore(): ChatStore {
    const records = new Map<MessageKey, ChatEventRecord>();
    let recordList: ReadonlyArray<ChatEventRecord> | undefined;
    let observed: HybridLogicalTime | undefined;
    const messages = new Map<MessageKey, ChatWindowMessageType>();
    const separators = new Map<MessageKey, ChatWindowMessageType>();
    const orphans = new Map<MessageKey, Array<ChatReceiptRecord>>();

    let orderedKeys: ReadonlyArray<MessageKey> = [];
    let messageList: ReadonlyArray<ChatWindowMessageType> = [];
    let messagePositions = new Map<MessageKey, number>();
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
        const sorted = [...messages.values()].sort(compareMessages);
        messageList = sorted;
        messagePositions = new Map(sorted.map((message, index) => [message.id, index]));

        const keys: MessageKey[] = [];
        const seen = new Set<MessageKey>();
        const restamped: Array<MessageKey> = [];
        let lastDay: number | undefined;

        // A timestamp is an absolute instant and a calendar day is a property of the device's timezone, so which
        // day a message belongs to needs no clock correction; applying one moves messages across midnight by the
        // difference between the two clocks.
        const separatorFor = (timestamp: number): void => {
            const localDay = new Date(timestamp).setHours(0, 0, 0, 0);
            if (lastDay === localDay) return;
            lastDay = localDay;
            // Local midnight is negative east of UTC inside the first day of the epoch, which the id format
            // refuses; the record keeps the true day, so ordering is unaffected.
            const key = toDateSeparatorId(Math.max(0, localDay));
            const text = fmtDay(localDay);
            const existing = separators.get(key);
            if (existing === undefined || existing.text !== text) {
                separators.set(key, { id: key, timestamp: localDay, sender: 'date', text });
                if (existing !== undefined) restamped.push(key);
            }
            keys.push(key);
            seen.add(key);
        };

        for (const message of sorted) {
            separatorFor(message.timestamp);
            keys.push(message.id);
        }
        separatorFor(serverTime());

        for (const key of [...separators.keys()]) {
            if (!seen.has(key)) separators.delete(key);
        }

        const changed = keys.length !== orderedKeys.length || keys.some((key, index) => key !== orderedKeys[index]);
        if (changed) {
            orderedKeys = keys;
            notify(keyListeners);
        }
        for (const key of restamped) {
            notifyMessage(key);
        }
        notify(anyListeners);
    }

    function project(receipt: ChatReceiptRecord): MessageKey | undefined {
        const target = messages.get(receipt.target);
        if (target === undefined) {
            const waiting = orphans.get(receipt.target) ?? [];
            if (!waiting.some((held) => held.id === receipt.id)) waiting.push(receipt);
            orphans.delete(receipt.target);
            orphans.set(receipt.target, waiting);
            while (orphans.size > MAX_ORPHAN_TARGETS) {
                const oldest = orphans.keys().next();
                if (oldest.done === true) break;
                orphans.delete(oldest.value);
            }
            return undefined;
        }
        const next = applyReceipt(target, receipt);
        if (sameMessage(target, next)) return undefined;
        messages.set(receipt.target, next);
        const index = messagePositions.get(receipt.target);
        if (index !== undefined && messageList[index] === target) {
            const updated = messageList.slice();
            updated[index] = next;
            messageList = updated;
        }
        return receipt.target;
    }

    function drainOrphans(target: MessageKey): Array<MessageKey> {
        const waiting = orphans.get(target);
        if (waiting === undefined) return [];
        orphans.delete(target);
        const touched: Array<MessageKey> = [];
        for (const receipt of waiting) {
            const key = project(receipt);
            if (key !== undefined) touched.push(key);
        }
        return touched;
    }

    function observe(record: ChatEventRecord): void {
        const candidate = { physical: record.timestamp, counter: record.counter ?? 0 };
        if (observed === undefined || compareHybridLogicalTime(candidate, observed) > 0) observed = candidate;
    }

    function ingest(record: ChatEventRecord): { touched: Array<MessageKey>; ordered: boolean } {
        observe(record);
        recordList = undefined;
        if (isChatMessageRecord(record)) {
            if (record.sender === 'date') return { touched: [], ordered: false };
            const { kind: _kind, ...message } = record;
            messages.set(record.id, message);
            records.set(record.id, record);
            return { touched: [record.id, ...drainOrphans(record.id)], ordered: true };
        }
        records.set(record.id, record);
        const touched = project(record);
        return { touched: touched === undefined ? [] : [touched], ordered: false };
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
            const registered = listeners;
            return () => {
                registered.delete(listener);
                if (registered.size === 0 && messageListeners.get(key) === registered) messageListeners.delete(key);
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
            const registered = listeners;
            return () => {
                registered.delete(listener);
                if (registered.size === 0 && highlightListeners.get(key) === registered) {
                    highlightListeners.delete(key);
                }
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
        getRecord: (key) => records.get(key),
        getRecords: () => (recordList ??= [...records.values()]),
        getObservedTime: () => observed,

        hydrate(next) {
            const persisted = new Set<MessageKey>(next.map((record) => record.id));
            const live = [...records.keys()].filter((key) => !persisted.has(key));
            const changed = new Set<MessageKey>();
            for (const record of next) {
                if (records.has(record.id)) continue;
                for (const key of ingest(record).touched) changed.add(key);
            }
            reindex();
            for (const key of changed) {
                notifyMessage(key);
            }
            emit([{ kind: 'reset' }, ...live.map((key) => ({ kind: 'upsert', key }) as const)]);
        },

        apply(record) {
            if (records.has(record.id)) return;
            const { touched, ordered } = ingest(record);
            // A receipt whose target has not arrived yet touches no message, but the record itself is still worth
            // persisting: it is what replays the receipt once the message lands.
            if (touched.length === 0) {
                emit([{ kind: 'upsert', key: record.id }]);
                return;
            }
            if (ordered) reindex();
            else notify(anyListeners);
            for (const key of touched) {
                notifyMessage(key);
            }
            emit([{ kind: 'upsert', key: record.id }]);
        },

        clear() {
            const keys = [...records.keys()];
            const dropped = [...records.values()];
            records.clear();
            recordList = undefined;
            messages.clear();
            orphans.clear();
            reindex();
            for (const key of keys) {
                notifyMessage(key);
            }
            emit([{ kind: 'clearAll', records: dropped }]);
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

const stores = new Map<ConversationId, ChatStore>();

export function getChatStore(conversationId: ConversationId): ChatStore {
    let store = stores.get(conversationId);
    if (store === undefined) {
        store = createChatStore();
        stores.set(conversationId, store);
    }
    return store;
}

export function disposeChatStore(conversationId: ConversationId): void {
    stores.delete(conversationId);
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
