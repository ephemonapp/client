import { ApplicationEvent, decodeApplicationEvent, encodeApplicationEvent } from '../src/mls/applicationEvent';
import { acceptChatEvent, authorChatEvent, authorHistoryBatch, EventSigner, EventVerifier } from '../src/mls/chatEvent';
import { DirectMlsMembership } from '../src/mls/directBootstrapProtocol';
import { decodeSignedApplicationEvent, encodeSignedApplicationEvent } from '../src/mls/signedEvent';
import { MemberNumber, toMemberNumber } from '../src/types/conversation';
import { toEventId } from '../src/types/eventId';

const OWN = toMemberNumber(0);
const PEER = toMemberNumber(1);
const THIRD = toMemberNumber(2);
const STRANGER = toMemberNumber(9);
const NOW = 1_700_000_000_000;
const quotedId = `m:${Buffer.from(new Uint8Array(32).fill(7)).toString('base64url')}`;

const membership: DirectMlsMembership = {
    role: 'creator',
    ownMemberNumber: OWN,
    owner: OWN,
    roster: [
        { memberNumber: OWN, publicKey: 'own-key', name: 'Own' },
        { memberNumber: PEER, publicKey: 'peer-key', name: 'Peer' },
        { memberNumber: THIRD, publicKey: 'third-key', name: 'Third' },
    ],
};

const SIGNATURE = new Uint8Array(64).fill(3);

const signs: EventSigner = async () => SIGNATURE;
const verifies: EventVerifier = async () => true;
const refutes: EventVerifier = async () => false;

function authored(author: MemberNumber, text = 'hello', signature: Uint8Array = SIGNATURE): Uint8Array {
    const event: ApplicationEvent = {
        time: { physical: NOW, counter: 0 },
        author,
        chain: { sequence: 0 },
        epoch: 1n,
        body: { kind: 'message.created', text },
    };
    return encodeSignedApplicationEvent({ bytes: encodeApplicationEvent(event), signature });
}

describe('acceptChatEvent authorship', () => {
    it('keeps the author in the envelope, so a re-served event is not attributed to whoever forwarded it', async () => {
        const accepted = await acceptChatEvent(authored(THIRD), PEER, membership, NOW, verifies);

        expect(accepted.kind).toBe('record');
        if (accepted.kind !== 'record') return;
        expect(Number(accepted.record.author)).toBe(2);
        expect(accepted.record.sender).toBe('peer');
    });

    it('refuses an event that claims this member wrote it', async () => {
        await expect(acceptChatEvent(authored(OWN), PEER, membership, NOW, verifies)).rejects.toThrow(
            /cannot claim to be authored by this member/,
        );
    });

    it('refuses an event that names an author outside the roster', async () => {
        await expect(acceptChatEvent(authored(STRANGER), PEER, membership, NOW, verifies)).rejects.toThrow(
            /outside the roster/,
        );
    });

    it('accepts this member as the author when this member is the MLS sender, which is a local echo', async () => {
        const accepted = await acceptChatEvent(authored(OWN), OWN, membership, NOW, verifies);

        expect(accepted.kind).toBe('record');
        if (accepted.kind !== 'record') return;
        expect(accepted.record.sender).toBe('you');
    });

    it('refuses an event stamped further in the future than the accepted skew', async () => {
        await expect(
            acceptChatEvent(authored(PEER), PEER, membership, NOW - 60 * 60 * 1000, verifies),
        ).rejects.toThrow();
    });
});

describe('a quoted message', () => {
    it('carries the author the caller resolved from the store', async () => {
        const event = await authorChatEvent(
            {
                kind: 'text',
                text: 'answer',
                replyTo: { id: toEventId(quotedId), sender: 'peer', text: 'asked' },
            },
            { sequence: 0 },
            membership,
            undefined,
            NOW,
            signs,
            1n,
            THIRD,
        );
        const decoded = decodeApplicationEvent(decodeSignedApplicationEvent(event.bytes).bytes);

        expect(decoded.body.kind).toBe('message.created');
        if (decoded.body.kind !== 'message.created') return;
        expect(Number(decoded.body.reply?.authorMemberNumber)).toBe(2);
    });

    it('is dropped rather than attributed to the wrong member when the author is unknown', async () => {
        const groupMembership = {
            ...membership,
            roster: [...membership.roster, { memberNumber: toMemberNumber(3), publicKey: 'fourth-key' }],
        };
        const event = await authorChatEvent(
            {
                kind: 'text',
                text: 'answer',
                replyTo: { id: toEventId(quotedId), sender: 'peer', text: 'asked' },
            },
            { sequence: 0 },
            groupMembership,
            undefined,
            NOW,
            signs,
            1n,
        );
        const decoded = decodeApplicationEvent(decodeSignedApplicationEvent(event.bytes).bytes);

        expect(decoded.body.kind).toBe('message.created');
        if (decoded.body.kind !== 'message.created') return;
        expect(decoded.body.reply).toBeUndefined();
    });
});

describe('the author signature on a durable event', () => {
    it('refuses an event whose signature does not verify for the member it names', async () => {
        await expect(acceptChatEvent(authored(THIRD), PEER, membership, NOW, refutes)).rejects.toThrow(
            /not signed by member 2/,
        );
    });

    it('refuses a durable event that carries no signature at all', async () => {
        const unsigned = authored(THIRD, 'hello', new Uint8Array());

        await expect(acceptChatEvent(unsigned, PEER, membership, NOW, verifies)).rejects.toThrow(
            /must carry its author signature/,
        );
    });

    it('signs what the author encoded, so the bytes a peer verifies are the bytes it decodes', async () => {
        const seen: Array<Uint8Array> = [];
        const authoredEvent = await authorChatEvent(
            { kind: 'text', text: 'signed' },
            { sequence: 0 },
            membership,
            undefined,
            NOW,
            async (bytes) => {
                seen.push(bytes);
                return SIGNATURE;
            },
            1n,
        );
        const frame = decodeSignedApplicationEvent(authoredEvent.bytes);

        expect(seen).toHaveLength(1);
        expect(frame.bytes).toEqual(seen[0]);
        expect(frame.signature).toEqual(SIGNATURE);
    });
});

describe('the epoch a durable event was written in', () => {
    function writtenIn(epoch: bigint): Uint8Array {
        const event: ApplicationEvent = {
            time: { physical: NOW, counter: 0 },
            author: THIRD,
            chain: { sequence: 0 },
            epoch,
            body: { kind: 'message.created', text: 'written before the newcomer joined' },
        };
        return encodeSignedApplicationEvent({ bytes: encodeApplicationEvent(event), signature: SIGNATURE });
    }

    it("is kept from the author rather than stamped with the receiver's current one", async () => {
        const accepted = await acceptChatEvent(writtenIn(2n), PEER, membership, NOW, verifies, 4n);

        expect(accepted.kind).toBe('record');
        if (accepted.kind !== 'record') return;
        expect(accepted.record.epoch).toBe('2');
    });

    it('refuses an epoch this member has not reached yet', async () => {
        await expect(acceptChatEvent(writtenIn(9n), PEER, membership, NOW, verifies, 4n)).rejects.toThrow(
            /has not reached/,
        );
    });
});

describe('a history batch', () => {
    it("hands back each event in its author's envelope, to be checked as if it had arrived alone", async () => {
        const first = authored(THIRD, 'first');
        const second = authored(PEER, 'second');
        const batch = await authorHistoryBatch([first, second], undefined, NOW);

        const accepted = await acceptChatEvent(batch, PEER, membership, NOW, verifies);

        expect(accepted.kind).toBe('batch');
        if (accepted.kind !== 'batch') return;
        expect(accepted.frames).toEqual([first, second]);
    });
});
