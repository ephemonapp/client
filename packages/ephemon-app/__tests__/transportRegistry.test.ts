import { createTransportRegistry } from '../src/mls/transportRegistry';
import { toConversationId } from '../src/types/conversation';
import { ConnectionState } from '@ephemon/core';
import type { Connection } from '@ephemon/core';

const GROUP = toConversationId(1);
const DIRECT = toConversationId(2);

function link(publicKey: string, state: ConnectionState): Connection {
    return { publicKey, state } as Connection;
}

describe('the transport registry', () => {
    it('offers only the links a frame can go out on', () => {
        const registry = createTransportRegistry();
        registry.register(GROUP, link('open-peer', ConnectionState.Open));
        registry.register(GROUP, link('degraded-peer', ConnectionState.Degraded));
        registry.register(GROUP, link('connecting-peer', ConnectionState.Connecting));

        expect(registry.usable(GROUP).map((connection) => connection.publicKey)).toEqual([
            'open-peer',
            'degraded-peer',
        ]);
    });

    it('moves every conversation riding on a peer onto the connection that replaced it', () => {
        const registry = createTransportRegistry();
        const stale = link('peer', ConnectionState.Closed);
        registry.register(GROUP, stale);
        registry.register(DIRECT, stale);
        const fresh = link('peer', ConnectionState.Open);

        expect(registry.replace(fresh).sort()).toEqual([GROUP, DIRECT].sort());
        expect(registry.usable(GROUP)).toEqual([fresh]);
        expect(registry.usable(DIRECT)).toEqual([fresh]);
    });

    it('reports the same connection object as no move at all', () => {
        const registry = createTransportRegistry();
        const connection = link('peer', ConnectionState.Open);
        registry.register(GROUP, connection);

        expect(registry.replace(connection)).toEqual([]);
    });

    it('names the conversations a peer carries', () => {
        const registry = createTransportRegistry();
        registry.register(GROUP, link('peer', ConnectionState.Open));
        registry.register(DIRECT, link('peer', ConnectionState.Open));
        registry.register(DIRECT, link('other', ConnectionState.Open));

        expect(registry.conversationsOn('peer').sort()).toEqual([GROUP, DIRECT].sort());
        expect(registry.conversationsOn('other')).toEqual([DIRECT]);
        expect(registry.conversationsOn('stranger')).toEqual([]);
    });

    it('answers for one member of a group at a time', () => {
        const registry = createTransportRegistry();
        registry.register(GROUP, link('peer', ConnectionState.Degraded));

        expect(registry.stateOf(GROUP, 'peer')).toBe(ConnectionState.Degraded);
        expect(registry.stateOf(GROUP, 'absent')).toBeUndefined();
        expect(registry.stateOf(DIRECT, 'peer')).toBeUndefined();
    });

    it('forgets a deleted conversation without touching the others', () => {
        const registry = createTransportRegistry();
        registry.register(GROUP, link('peer', ConnectionState.Open));
        registry.register(DIRECT, link('peer', ConnectionState.Open));

        registry.forget(GROUP);

        expect(registry.usable(GROUP)).toEqual([]);
        expect(registry.conversationsOn('peer')).toEqual([DIRECT]);
    });
});
