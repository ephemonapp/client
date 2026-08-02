import { ChatWindowMessageType } from '../types/chatMessageType';
import { ConnectionState } from '@ephemon/core';
import { useCallback, useRef } from 'react';

export type ConnectionCallbacks = {
    lifecycle: {
        open: () => Promise<void>;
    };
    view: {
        setOrder: (value: number) => void;
    };
    messaging: {
        send: (message: string) => void;
        history: {
            get: () => Promise<Array<ChatWindowMessageType>>;
            save: (upserts: ReadonlyArray<ChatWindowMessageType>, deletes: ReadonlyArray<string>) => Promise<void>;
            clear: () => Promise<void>;
        };
    };
    events: {
        setOnProgress: (onProgress: (progress: number) => void) => void;
        setOnStateChanged: (onStateChanged: (from: ConnectionState, to: ConnectionState) => void) => void;
        setOnMessage: (onMessage: (message: string) => void) => void;
    };
};

export type ConnectionCallbacksById = {
    lifecycle: {
        open: (id: number) => Promise<void>;
    };
    view: {
        setOrder: (id: number, value: number) => void;
    };
    messaging: {
        send: (id: number, message: string) => void;
        history: {
            get: (id: number) => Promise<Array<ChatWindowMessageType>>;
            save: (
                id: number,
                upserts: ReadonlyArray<ChatWindowMessageType>,
                deletes: ReadonlyArray<string>,
            ) => Promise<void>;
            clear: (id: number) => Promise<void>;
        };
    };
    events: {
        setOnProgress: (id: number, onProgress: (progress: number) => void) => void;
        setOnStateChanged: (id: number, onStateChanged: (from: ConnectionState, to: ConnectionState) => void) => void;
        setOnMessage: (id: number, onMessage: (message: string) => void) => void;
    };
};

export function useConnectionCallbacksCache(source: ConnectionCallbacksById): (id: number) => ConnectionCallbacks {
    const sourceRef = useRef(source);
    const cacheRef = useRef<Map<number, ConnectionCallbacks>>(new Map());

    const previous = sourceRef.current;
    if (
        previous.lifecycle.open !== source.lifecycle.open ||
        previous.view.setOrder !== source.view.setOrder ||
        previous.messaging.send !== source.messaging.send ||
        previous.messaging.history.get !== source.messaging.history.get ||
        previous.messaging.history.save !== source.messaging.history.save ||
        previous.messaging.history.clear !== source.messaging.history.clear ||
        previous.events.setOnProgress !== source.events.setOnProgress ||
        previous.events.setOnStateChanged !== source.events.setOnStateChanged ||
        previous.events.setOnMessage !== source.events.setOnMessage
    ) {
        sourceRef.current = source;
        cacheRef.current = new Map();
    }

    return useCallback((id: number): ConnectionCallbacks => {
        const cached = cacheRef.current.get(id);
        if (cached !== undefined) return cached;

        const bound = sourceRef.current;
        const callbacks: ConnectionCallbacks = {
            lifecycle: { open: () => bound.lifecycle.open(id) },
            view: { setOrder: (value) => bound.view.setOrder(id, value) },
            messaging: {
                send: (message) => bound.messaging.send(id, message),
                history: {
                    get: () => bound.messaging.history.get(id),
                    save: (upserts, deletes) => bound.messaging.history.save(id, upserts, deletes),
                    clear: () => bound.messaging.history.clear(id),
                },
            },
            events: {
                setOnProgress: (onProgress) => bound.events.setOnProgress(id, onProgress),
                setOnStateChanged: (onStateChanged) => bound.events.setOnStateChanged(id, onStateChanged),
                setOnMessage: (onMessage) => bound.events.setOnMessage(id, onMessage),
            },
        };
        cacheRef.current.set(id, callbacks);
        return callbacks;
    }, []);
}
