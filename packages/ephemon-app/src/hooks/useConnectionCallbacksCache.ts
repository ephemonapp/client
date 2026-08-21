import { ChatOperation, InboundChatEvent } from '../types/chatOperation';
import { ChatEventRecord } from '../types/chatRecord';
import { ConversationId } from '../types/conversation';
import { ConnectionState } from '@ephemon/core';
import { useCallback, useRef } from 'react';

export type ConnectionCallbacks = {
    lifecycle: {
        open: () => Promise<void>;
        addMember: (publicKey: string, serverUrl?: string) => Promise<void>;
    };
    view: {
        setOrder: (value: number) => void;
    };
    messaging: {
        send: (operation: ChatOperation) => Promise<ChatEventRecord | undefined>;
        history: {
            get: () => Promise<Array<ChatEventRecord>>;
            save: (upserts: ReadonlyArray<ChatEventRecord>, deletes: ReadonlyArray<string>) => Promise<void>;
            clear: (records: ReadonlyArray<ChatEventRecord>) => Promise<void>;
        };
    };
    events: {
        setOnProgress: (onProgress: (progress: number) => void) => void;
        setOnStateChanged: (onStateChanged: (from: ConnectionState, to: ConnectionState) => void) => void;
        setOnEvent: (onEvent: (event: InboundChatEvent) => void) => void;
    };
};

export type ConnectionCallbacksById = {
    lifecycle: {
        open: (id: ConversationId) => Promise<void>;
        addMember: (id: ConversationId, publicKey: string, serverUrl?: string) => Promise<void>;
    };
    view: {
        setOrder: (id: ConversationId, value: number) => void;
    };
    messaging: {
        send: (id: ConversationId, operation: ChatOperation) => Promise<ChatEventRecord | undefined>;
        history: {
            get: (id: ConversationId) => Promise<Array<ChatEventRecord>>;
            save: (
                id: ConversationId,
                upserts: ReadonlyArray<ChatEventRecord>,
                deletes: ReadonlyArray<string>,
            ) => Promise<void>;
            clear: (id: ConversationId, records: ReadonlyArray<ChatEventRecord>) => Promise<void>;
        };
    };
    events: {
        setOnProgress: (id: ConversationId, onProgress: (progress: number) => void) => void;
        setOnStateChanged: (
            id: ConversationId,
            onStateChanged: (from: ConnectionState, to: ConnectionState) => void,
        ) => void;
        setOnEvent: (id: ConversationId, onEvent: (event: InboundChatEvent) => void) => void;
    };
};

export function useConnectionCallbacksCache(
    source: ConnectionCallbacksById,
): (id: ConversationId) => ConnectionCallbacks {
    const sourceRef = useRef(source);
    const cacheRef = useRef<Map<ConversationId, ConnectionCallbacks>>(new Map());

    const previous = sourceRef.current;
    if (
        previous.lifecycle.open !== source.lifecycle.open ||
        previous.lifecycle.addMember !== source.lifecycle.addMember ||
        previous.view.setOrder !== source.view.setOrder ||
        previous.messaging.send !== source.messaging.send ||
        previous.messaging.history.get !== source.messaging.history.get ||
        previous.messaging.history.save !== source.messaging.history.save ||
        previous.messaging.history.clear !== source.messaging.history.clear ||
        previous.events.setOnProgress !== source.events.setOnProgress ||
        previous.events.setOnStateChanged !== source.events.setOnStateChanged ||
        previous.events.setOnEvent !== source.events.setOnEvent
    ) {
        sourceRef.current = source;
        cacheRef.current = new Map();
    }

    return useCallback((id: ConversationId): ConnectionCallbacks => {
        const cached = cacheRef.current.get(id);
        if (cached !== undefined) return cached;

        const bound = sourceRef.current;
        const callbacks: ConnectionCallbacks = {
            lifecycle: {
                open: () => bound.lifecycle.open(id),
                addMember: (publicKey, serverUrl) => bound.lifecycle.addMember(id, publicKey, serverUrl),
            },
            view: { setOrder: (value) => bound.view.setOrder(id, value) },
            messaging: {
                send: (operation) => bound.messaging.send(id, operation),
                history: {
                    get: () => bound.messaging.history.get(id),
                    save: (upserts, deletes) => bound.messaging.history.save(id, upserts, deletes),
                    clear: (records) => bound.messaging.history.clear(id, records),
                },
            },
            events: {
                setOnProgress: (onProgress) => bound.events.setOnProgress(id, onProgress),
                setOnStateChanged: (onStateChanged) => bound.events.setOnStateChanged(id, onStateChanged),
                setOnEvent: (onEvent) => bound.events.setOnEvent(id, onEvent),
            },
        };
        cacheRef.current.set(id, callbacks);
        return callbacks;
    }, []);
}
