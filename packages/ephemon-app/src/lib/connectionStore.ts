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

const statuses = createKeyedStore<ConnectionStatus>(CLOSED, shallowEqual);
const progresses = createKeyedStore<number>(0);
const unreads = createKeyedStore<number>(0);
const orders = createKeyedStore<number>(0);

let orderRevision = 0;
const orderRevisionListeners = new Set<() => void>();

export function setConnectionState(publicKey: string, state: UiConnectionState): void {
    statuses.update(publicKey, (previous) => ({
        ...previous,
        state,
        notice: state === 'open' || state === 'degraded' ? undefined : previous.notice,
    }));
}

export function setConnectionNotice(publicKey: string, notice: ConnectionNotice | undefined): void {
    statuses.update(publicKey, (previous) => ({ ...previous, notice }));
}

export function setConnectionTransport(publicKey: string, transport: UiTransport | undefined): void {
    statuses.update(publicKey, (previous) => ({ ...previous, transport }));
}

export function setConnectionProgress(publicKey: string, progress: number): void {
    progresses.set(publicKey, progress);
}

export function setUnreadCount(publicKey: string, unread: number): void {
    unreads.set(publicKey, unread);
}

const orderValues = new Map<string, number>();
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

export function setConversationOrder(publicKey: string, order: number): void {
    if (orderValues.get(publicKey) === order) return;
    orderValues.set(publicKey, order);
    orders.set(publicKey, order);
    refreshOrderSequence();
}

export function getConversationOrder(publicKey: string): number {
    return orders.get(publicKey);
}

export function forgetConnection(publicKey: string): void {
    statuses.remove(publicKey);
    progresses.remove(publicKey);
    unreads.remove(publicKey);
    orders.remove(publicKey);
    orderValues.delete(publicKey);
    refreshOrderSequence();
}

let activeConversation: number | undefined;
const activeConversationListeners = new Set<() => void>();

export function setActiveConversation(id: number | undefined): void {
    if (activeConversation === id) return;
    activeConversation = id;
    for (const listener of activeConversationListeners) {
        listener();
    }
}

export function getActiveConversation(): number | undefined {
    return activeConversation;
}

export function subscribeActiveConversation(listener: () => void): () => void {
    activeConversationListeners.add(listener);
    return () => {
        activeConversationListeners.delete(listener);
    };
}

export function useActiveConversation(): number | undefined {
    return useSyncExternalStore(subscribeActiveConversation, getActiveConversation);
}

export function useConnectionStatus(publicKey: string): ConnectionStatus {
    return useSyncExternalStore(
        (listener) => statuses.subscribe(publicKey, listener),
        () => statuses.get(publicKey),
    );
}

export function useConnectionNotice(publicKey: string): ConnectionNotice | undefined {
    return useConnectionStatus(publicKey).notice;
}

export function useConnectionProgress(publicKey: string): number {
    return useSyncExternalStore(
        (listener) => progresses.subscribe(publicKey, listener),
        () => progresses.get(publicKey),
    );
}

export function useUnreadCount(publicKey: string): number {
    return useSyncExternalStore(
        (listener) => unreads.subscribe(publicKey, listener),
        () => unreads.get(publicKey),
    );
}

export function useConversationOrder(publicKey: string): number {
    return useSyncExternalStore(
        (listener) => orders.subscribe(publicKey, listener),
        () => orders.get(publicKey),
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
