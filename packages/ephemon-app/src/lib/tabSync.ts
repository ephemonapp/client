const CHANNEL_NAME = 'ephemon-history';

export type HistoryChange = { id: number; cleared: boolean };

type Channel = {
    postMessage(message: HistoryChange): void;
    close(): void;
    onmessage: ((event: { data: HistoryChange }) => void) | null;
};

const listeners = new Set<(change: HistoryChange) => void>();
let channel: Channel | null | undefined;

function shared(): Channel | undefined {
    if (channel === undefined) {
        const constructor = (globalThis as { BroadcastChannel?: new (name: string) => Channel }).BroadcastChannel;
        channel = constructor === undefined ? null : new constructor(CHANNEL_NAME);
        if (channel !== null) {
            channel.onmessage = (event) => {
                for (const listener of [...listeners]) listener(event.data);
            };
        }
    }
    return channel ?? undefined;
}

export function publishHistoryChange(change: HistoryChange): void {
    shared()?.postMessage(change);
}

export function subscribeHistoryChange(listener: (change: HistoryChange) => void): () => void {
    if (shared() === undefined) return () => {};
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
