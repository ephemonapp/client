import { fromSelfChatUpdate, toSelfChatUpdate } from '../src/lib/selfChatUpdate';
import { toSelfChatRecordId } from '../src/types/eventId';

const FIRST = 1_700_000_000_000;
const SECOND = 1_700_000_000_001;

describe('self-chat receipts', () => {
    it('identifies a receipt by what it is about, not by when it was made', () => {
        const first = toSelfChatUpdate({ kind: 'delivered', target: toSelfChatRecordId('peer', 'message', FIRST) });
        const second = toSelfChatUpdate({ kind: 'delivered', target: toSelfChatRecordId('peer', 'message', SECOND) });

        expect(first.record?.id).not.toBe(second.record?.id);
    });

    it('gives the same receipt the same identifier twice, so a repeat is not a second row', () => {
        const target = toSelfChatRecordId('peer', 'message', FIRST);

        expect(toSelfChatUpdate({ kind: 'seen', target }).record?.id).toBe(
            toSelfChatUpdate({ kind: 'seen', target }).record?.id,
        );
    });

    it('keeps two receipts of one batch apart on the receiving side', () => {
        const events = [
            ...fromSelfChatUpdate({ id: FIRST, delivered: { timestamp: FIRST + 5 } } as never),
            ...fromSelfChatUpdate({ id: SECOND, delivered: { timestamp: FIRST + 5 } } as never),
        ].filter((event) => event.kind === 'record');

        const ids = events.map((event) => (event.kind === 'record' ? event.record.id : ''));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('keeps a receipt apart from the message it is about', () => {
        const target = toSelfChatRecordId('peer', 'message', FIRST);

        expect(toSelfChatUpdate({ kind: 'seen', target }).record?.id).not.toBe(target);
    });
});
