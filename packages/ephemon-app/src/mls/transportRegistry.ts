import { ConversationId } from '../types/conversation';
import { Connection, ConnectionState } from '@ephemon/core';

function carries(connection: Connection): boolean {
    return connection.state === ConnectionState.Open || connection.state === ConnectionState.Degraded;
}

/** The links each conversation rides on, keyed by peer. */
export type TransportRegistry = ReturnType<typeof createTransportRegistry>;

export function createTransportRegistry() {
    const byConversation = new Map<ConversationId, Map<string, Connection>>();

    return {
        register(id: ConversationId, connection: Connection): void {
            const transports = byConversation.get(id) ?? new Map<string, Connection>();
            transports.set(connection.publicKey, connection);
            byConversation.set(id, transports);
        },

        /** Points every conversation on this peer at the connection that replaced theirs; returns the moved ones. */
        replace(connection: Connection): Array<ConversationId> {
            const moved: Array<ConversationId> = [];
            for (const [id, transports] of byConversation) {
                const existing = transports.get(connection.publicKey);
                if (existing === undefined || existing === connection) continue;
                transports.set(connection.publicKey, connection);
                moved.push(id);
            }
            return moved;
        },

        usable(id: ConversationId): Array<Connection> {
            return [...(byConversation.get(id)?.values() ?? [])].filter(carries);
        },

        stateOf(id: ConversationId, peerPublicKey: string): ConnectionState | undefined {
            return byConversation.get(id)?.get(peerPublicKey)?.state;
        },

        conversationsOn(peerPublicKey: string): Array<ConversationId> {
            const ids: Array<ConversationId> = [];
            for (const [id, transports] of byConversation) {
                if (transports.has(peerPublicKey)) ids.push(id);
            }
            return ids;
        },

        forget(id: ConversationId): void {
            byConversation.delete(id);
        },

        /** Drops a peer's link from every conversation, so nothing reports it as a way to reach them. */
        forgetPeer(peerPublicKey: string): void {
            for (const transports of byConversation.values()) transports.delete(peerPublicKey);
        },
    };
}
