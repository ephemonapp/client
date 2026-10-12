import { disposeChatStore, getChatStore } from '../src/lib/chatStore';
import { ChatEventRecord } from '../src/types/chatRecord';
import { toConversationId, toMemberNumber } from '../src/types/conversation';
import { toEventId } from '../src/types/eventId';

const CONVERSATION = toConversationId(4242);
const PEER = toMemberNumber(1);
const THIRD = toMemberNumber(2);

function eventId(seed: number): string {
    const bytes = new Uint8Array(32).fill(seed);
    return `m:${Buffer.from(bytes).toString('base64url')}`;
}

function message(id: string, timestamp = 1_000): ChatEventRecord {
    return {
        kind: 'message',
        id: toEventId(id),
        sender: 'peer',
        text: `text of ${id}`,
        timestamp,
        author: PEER,
        sequence: 0,
        counter: 0,
    } as ChatEventRecord;
}

function receipt(
    kind: 'seen' | 'delivered' | 'reaction',
    target: string,
    author: number,
    value?: string,
    timestamp = 2_000,
): ChatEventRecord {
    return {
        kind,
        id: toEventId(eventId(200 + author * 10 + (value === undefined ? 0 : value.codePointAt(0)! % 7))),
        sender: 'peer',
        timestamp,
        target: toEventId(target),
        value,
        author: toMemberNumber(author),
        counter: 0,
    } as ChatEventRecord;
}

function messageFrom(
    id: string,
    author: number,
    fields: { timestamp?: number; counter?: number; sequence?: number; sender?: 'you' | 'peer' } = {},
): ChatEventRecord {
    return {
        kind: 'message',
        id: toEventId(id),
        sender: fields.sender ?? 'peer',
        text: `text of ${id}`,
        timestamp: fields.timestamp ?? 1_000,
        counter: fields.counter ?? 0,
        author: toMemberNumber(author),
        sequence: fields.sequence ?? 0,
    } as ChatEventRecord;
}

function keysOf(records: ReadonlyArray<ChatEventRecord>): ReadonlyArray<string> {
    const conversation = toConversationId(4343);
    const store = getChatStore(conversation);
    for (const record of records) store.apply(record);
    const keys = store.getKeys().filter((key) => !key.startsWith('d:'));
    disposeChatStore(conversation);
    return keys;
}

describe('message order', () => {
    it('does not depend on the order events arrived in', () => {
        const first = messageFrom(eventId(20), 1, { sequence: 0 });
        const second = messageFrom(eventId(21), 1, { sequence: 1 });

        expect(keysOf([first, second])).toEqual(keysOf([second, first]));
    });

    it('breaks a tie on the logical counter before anything else', () => {
        const later = messageFrom(eventId(22), 1, { counter: 2 });
        const earlier = messageFrom(eventId(23), 1, { counter: 1 });

        expect(keysOf([later, earlier])).toEqual([earlier.id, later.id]);
    });

    it('breaks a counter tie on the author, not on who sent it', () => {
        const fromTwo = messageFrom(eventId(24), 2, { sender: 'you' });
        const fromOne = messageFrom(eventId(25), 1, { sender: 'peer' });

        expect(keysOf([fromTwo, fromOne])).toEqual([fromOne.id, fromTwo.id]);
    });

    it('breaks an author tie on the sequence', () => {
        const second = messageFrom(eventId(26), 1, { sequence: 1 });
        const first = messageFrom(eventId(27), 1, { sequence: 0 });

        expect(keysOf([second, first])).toEqual([first.id, second.id]);
    });

    it('falls back to the event id, so two replicas cannot disagree', () => {
        const high = messageFrom(eventId(28), 1);
        const low = messageFrom(eventId(29), 1);
        const expected = [high.id, low.id].sort();

        expect(keysOf([high, low])).toEqual(expected);
        expect(keysOf([low, high])).toEqual(expected);
    });

    it('leaves the order alone when a receipt lands', () => {
        const conversation = toConversationId(4444);
        const store = getChatStore(conversation);
        store.apply(messageFrom(eventId(30), 1, { sequence: 0 }));
        store.apply(messageFrom(eventId(31), 1, { sequence: 1 }));
        const before = store.getKeys();

        store.apply(receipt('seen', eventId(30), 1));

        expect(store.getKeys()).toEqual(before);
        disposeChatStore(conversation);
    });
});

describe('the chat store', () => {
    afterEach(() => disposeChatStore(CONVERSATION));

    it('keeps a receipt per member instead of collapsing the group into one verdict', () => {
        const store = getChatStore(CONVERSATION);
        store.apply(message(eventId(1)));
        store.apply(receipt('seen', eventId(1), 1));
        store.apply(receipt('seen', eventId(1), 2));

        const seenBy = store.getMessage(toEventId(eventId(1)))?.seenBy ?? [];
        expect(seenBy.map((entry) => Number(entry.author)).sort()).toEqual([1, 2]);
    });

    it('groups one chip per emoji and counts the members behind it', () => {
        const store = getChatStore(CONVERSATION);
        store.apply(message(eventId(2)));
        store.apply(receipt('reaction', eventId(2), 1, '👍'));
        store.apply(receipt('reaction', eventId(2), 2, '👍'));

        const reactions = store.getMessage(toEventId(eventId(2)))?.reactions ?? [];
        expect(reactions).toHaveLength(1);
        expect(reactions[0].value).toBe('👍');
        expect(reactions[0].authors.map(Number).sort()).toEqual([1, 2]);
    });

    it('drops only the reaction of the member that repeated it', () => {
        const store = getChatStore(CONVERSATION);
        store.apply(message(eventId(3)));
        store.apply(receipt('reaction', eventId(3), 1, '👍'));
        store.apply(receipt('reaction', eventId(3), 2, '👍'));
        store.apply(receipt('reaction', eventId(3), 2, '', 3_000));

        const reactions = (store.getMessage(toEventId(eventId(3)))?.reactions ?? []).filter(
            (entry) => entry.value.length > 0,
        );
        expect(reactions).toHaveLength(1);
        expect(reactions[0].authors.map(Number)).toEqual([1]);
    });

    it('does not let a replayed older pick undo a member that cleared its reaction', () => {
        const store = getChatStore(CONVERSATION);
        store.apply(message(eventId(9)));
        store.apply(receipt('reaction', eventId(9), 1, '', 3_000));
        store.apply(receipt('reaction', eventId(9), 1, '💜', 2_000));

        const reactions = (store.getMessage(toEventId(eventId(9)))?.reactions ?? []).filter(
            (entry) => entry.value.length > 0,
        );
        expect(reactions).toHaveLength(0);
    });

    it('replaces a member reaction when that member picks a different emoji', () => {
        const store = getChatStore(CONVERSATION);
        store.apply(message(eventId(4)));
        store.apply(receipt('reaction', eventId(4), 1, '👍'));
        store.apply(receipt('reaction', eventId(4), 1, '🔥', 3_000));

        const reactions = store.getMessage(toEventId(eventId(4)))?.reactions ?? [];
        expect(reactions.map((entry) => entry.value)).toEqual(['🔥']);
    });

    it('keeps the newer reaction when an older one from the same member arrives late', () => {
        const store = getChatStore(CONVERSATION);
        store.apply(message(eventId(4)));
        store.apply(receipt('reaction', eventId(4), 1, '🔥', 3_000));
        store.apply(receipt('reaction', eventId(4), 1, '👍', 2_000));

        const reactions = store.getMessage(toEventId(eventId(4)))?.reactions ?? [];
        expect(reactions.map((entry) => entry.value)).toEqual(['🔥']);
    });

    it('keeps a reaction when a removal from before it arrives late', () => {
        const store = getChatStore(CONVERSATION);
        store.apply(message(eventId(4)));
        store.apply(receipt('reaction', eventId(4), 1, '🔥', 3_000));
        store.apply(receipt('reaction', eventId(4), 1, '', 2_000));

        const reactions = store.getMessage(toEventId(eventId(4)))?.reactions ?? [];
        expect(reactions.map((entry) => entry.value)).toEqual(['🔥']);
    });

    it('applies a receipt that arrived before its message once the message lands', () => {
        const store = getChatStore(CONVERSATION);
        store.apply(receipt('seen', eventId(5), 1));
        store.apply(message(eventId(5)));

        expect(store.getMessage(toEventId(eventId(5)))?.seenBy?.map((entry) => Number(entry.author))).toEqual([1]);
    });

    it('maintains the highest hybrid logical time it has seen', () => {
        const store = getChatStore(CONVERSATION);
        expect(store.getObservedTime()).toBeUndefined();

        store.apply(message(eventId(6), 5_000));
        store.apply(message(eventId(7), 4_000));

        expect(store.getObservedTime()).toEqual({ physical: 5_000, counter: 0 });
    });

    it('keeps a reaction when the same stored history is hydrated again', () => {
        const store = getChatStore(CONVERSATION);
        const history = [message(eventId(9)), receipt('reaction', eventId(9), 1, '👍')];
        store.hydrate(history);
        store.hydrate(history);

        const reactions = store.getMessage(toEventId(eventId(9)))?.reactions ?? [];
        expect(reactions.map((entry) => entry.value)).toEqual(['👍']);
    });

    it('keeps the observed time across a clear, so what this member authors next still sorts after it', () => {
        const store = getChatStore(CONVERSATION);
        store.apply(message(eventId(8), 5_000));
        store.clear();

        expect(store.getObservedTime()).toEqual({ physical: 5_000, counter: 0 });
    });
});
