import {
    APPLICATION_EVENT_VERSION,
    ApplicationEvent,
    applicationEventHash,
    decodeApplicationEvent,
    encodeApplicationEvent,
    isDurableApplicationEvent,
} from '../src/mls/applicationEvent';
import { toMemberNumber } from '../src/types/conversation';

const AUTHOR = toMemberNumber(2);

function durable(text: string): ApplicationEvent {
    return {
        time: { physical: 1_700_000_000_000, counter: 3 },
        author: AUTHOR,
        chain: { sequence: 7, previous: new Uint8Array(32).fill(9) },
        epoch: 1n,
        body: { kind: 'message.created', text },
    };
}

describe('the application event codec', () => {
    it('carries the author of a durable event through a round trip', () => {
        const decoded = decodeApplicationEvent(encodeApplicationEvent(durable('hello')));

        expect(isDurableApplicationEvent(decoded)).toBe(true);
        if (!isDurableApplicationEvent(decoded)) return;
        expect(Number(decoded.author)).toBe(2);
        expect(decoded.chain).toEqual({ sequence: 7, previous: new Uint8Array(32).fill(9) });
        expect(decoded.time).toEqual({ physical: 1_700_000_000_000, counter: 3 });
        expect(decoded.body).toEqual({ kind: 'message.created', text: 'hello' });
    });

    it('round trips a reply with the author of the quoted message', () => {
        const event = {
            ...durable('answer'),
            body: {
                kind: 'message.created',
                text: 'answer',
                reply: { targetHash: new Uint8Array(32).fill(4), authorMemberNumber: toMemberNumber(5), text: 'asked' },
            },
        } as ApplicationEvent;
        const decoded = decodeApplicationEvent(encodeApplicationEvent(event));

        expect(decoded.body).toEqual(event.body);
    });

    it('round trips an ephemeral event, which carries no author or chain', () => {
        const decoded = decodeApplicationEvent(
            encodeApplicationEvent({ time: { physical: 5, counter: 0 }, body: { kind: 'typing' } }),
        );

        expect(isDurableApplicationEvent(decoded)).toBe(false);
        expect(decoded.body).toEqual({ kind: 'typing' });
    });

    it('refuses bytes from another version of the format', () => {
        const bytes = encodeApplicationEvent(durable('hello'));
        bytes[0] = APPLICATION_EVENT_VERSION + 1;

        expect(() => decodeApplicationEvent(bytes)).toThrow();
    });

    it('addresses an event by its content: the same event hashes the same, a changed one does not', async () => {
        const [first, again, changed] = await Promise.all([
            applicationEventHash(encodeApplicationEvent(durable('hello'))),
            applicationEventHash(encodeApplicationEvent(durable('hello'))),
            applicationEventHash(encodeApplicationEvent(durable('hello!'))),
        ]);

        expect(first).toEqual(again);
        expect(first).not.toEqual(changed);
    });
});
