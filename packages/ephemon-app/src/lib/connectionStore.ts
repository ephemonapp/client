import { ConversationId } from '../types/conversation';
import { createKeyedStore, shallowEqual } from './keyedStore';
import { ConnectionNotice } from './notice';
import { UiConnectionState, UiTransport } from './status';
import { useSyncExternalStore } from 'react';

export type ConnectionStatus = {
    state: UiConnectionState;
    transport?: UiTransport;
    notice?: ConnectionNotice;
};

const CLOSED: ConnectionStatus = { state: 'closed', transport: undefined, notice: undefined };

const statuses = createKeyedStore<ConnectionStatus, ConversationId>(CLOSED, shallowEqual);
const progresses = createKeyedStore<number, ConversationId>(0);
const unreads = createKeyedStore<number, ConversationId>(0);
const orders = createKeyedStore<number, ConversationId>(0);

let orderRevision = 0;
const orderRevisionListeners = new Set<() => void>();

export function setConnectionState(conversationId: ConversationId, state: UiConnectionState): void {
    statuses.update(conversationId, (previous) => ({
        ...previous,
        state,
        notice: state === 'open' || state === 'degraded' ? undefined : previous.notice,
    }));
}

export function setConnectionNotice(conversationId: ConversationId, notice: ConnectionNotice | undefined): void {
    statuses.update(conversationId, (previous) => ({ ...previous, notice }));
}

export function setConnectionTransport(conversationId: ConversationId, transport: UiTransport | undefined): void {
    statuses.update(conversationId, (previous) => ({ ...previous, transport }));
}

export function setConnectionProgress(conversationId: ConversationId, progress: number): void {
    progresses.set(conversationId, progress);
}

export function setUnreadCount(conversationId: ConversationId, unread: number): void {
    unreads.set(conversationId, unread);
}

const orderValues = new Map<ConversationId, number>();
let orderSequence = '';

function refreshOrderSequence(): void {
    const next = [...orderValues.entries()]
        .sort(([, a], [, b]) => b - a)
        .map(([key]) => key)
        .join('|');
    if (next === orderSequence) return;
    orderSequence = next;
    orderRevision += 1;
    for (const listener of orderRevisionListeners) {
        listener();
    }
}

export function setConversationOrder(conversationId: ConversationId, order: number): void {
    if (orderValues.get(conversationId) === order) return;
    orderValues.set(conversationId, order);
    orders.set(conversationId, order);
    refreshOrderSequence();
}

export function getConversationOrder(conversationId: ConversationId): number {
    return orders.get(conversationId);
}

export function forgetConversation(conversationId: ConversationId): void {
    statuses.remove(conversationId);
    progresses.remove(conversationId);
    unreads.remove(conversationId);
    orders.remove(conversationId);
    orderValues.delete(conversationId);
    refreshOrderSequence();
}

let activeConversation: ConversationId | undefined;
const activeConversationListeners = new Set<() => void>();

export function setActiveConversation(id: ConversationId | undefined): void {
    if (activeConversation === id) return;
    activeConversation = id;
    for (const listener of activeConversationListeners) {
        listener();
    }
}

export function getActiveConversation(): ConversationId | undefined {
    return activeConversation;
}

export function subscribeActiveConversation(listener: () => void): () => void {
    activeConversationListeners.add(listener);
    return () => {
        activeConversationListeners.delete(listener);
    };
}

export function useActiveConversation(): ConversationId | undefined {
    return useSyncExternalStore(subscribeActiveConversation, getActiveConversation);
}

export function useConnectionStatus(conversationId: ConversationId): ConnectionStatus {
    return useSyncExternalStore(
        (listener) => statuses.subscribe(conversationId, listener),
        () => statuses.get(conversationId),
    );
}

export function useConnectionNotice(conversationId: ConversationId): ConnectionNotice | undefined {
    return useConnectionStatus(conversationId).notice;
}

export function useConnectionProgress(conversationId: ConversationId): number {
    return useSyncExternalStore(
        (listener) => progresses.subscribe(conversationId, listener),
        () => progresses.get(conversationId),
    );
}

export function useUnreadCount(conversationId: ConversationId): number {
    return useSyncExternalStore(
        (listener) => unreads.subscribe(conversationId, listener),
        () => unreads.get(conversationId),
    );
}

export function useConversationOrder(conversationId: ConversationId): number {
    return useSyncExternalStore(
        (listener) => orders.subscribe(conversationId, listener),
        () => orders.get(conversationId),
    );
}

export function useConversationOrderRevision(): number {
    return useSyncExternalStore(
        (listener) => {
            orderRevisionListeners.add(listener);
            return () => {
                orderRevisionListeners.delete(listener);
            };
        },
        () => orderRevision,
    );
}
