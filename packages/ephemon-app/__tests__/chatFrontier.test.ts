import {
    clampOwnAuthorFrontier,
    computeChatFrontier,
    decodeChatFrontier,
    encodeChatFrontier,
    missingForPeer,
} from '../src/mls/chatFrontier';
import { ChatEventRecord } from '../src/types/chatRecord';
import { toMemberNumber } from '../src/types/conversation';
import { toEventId } from '../src/types/eventId';

const AUTHOR = toMemberNumber(3);
const OTHER = toMemberNumber(7);

function record(author: number, sequence: number): ChatEventRecord {
    const hash = new Uint8Array(32).fill(sequence + 1);
    return {
        kind: 'message',
        id: toEventId(`m:${Buffer.from(hash).toString('base64url')}`),
        sender: 'peer',
        text: `event ${author}/${sequence}`,
        timestamp: 1_000 + sequence,
        author: toMemberNumber(author),
        sequence,
    } as ChatEventRecord;
}

describe('computeChatFrontier', () => {
    it('reports the contiguous run, the holes above it and the highest sequence held', () => {
        const frontier = computeChatFrontier([record(3, 0), record(3, 1), record(3, 3)]);

        expect(frontier).toHaveLength(1);
        expect(frontier[0]).toMatchObject({ author: AUTHOR, contiguous: 1, highest: 3 });
        expect(frontier[0].holes).toEqual([{ from: 2, to: 2 }]);
    });

    it('counts a cleared range as held so cleared events are never asked for again', () => {
        const frontier = computeChatFrontier([], [{ author: AUTHOR, through: 4 }]);

        expect(frontier[0]).toMatchObject({ contiguous: 4, highest: 4 });
        expect(frontier[0].holes).toEqual([]);
    });

    it('lists a roster member it holds nothing from, so a peer can tell it apart from an unknown one', () => {
        const frontier = computeChatFrontier([], [], [AUTHOR, OTHER]);

        expect(frontier.map((entry) => entry.author)).toEqual([AUTHOR, OTHER]);
        expect(frontier[0]).toMatchObject({ contiguous: -1, highest: -1 });
    });
});

describe('the hole scan', () => {
    it('reads the gaps off the positions it holds, so a huge claimed sequence cannot hang the tab', () => {
        const started = Date.now();
        const frontier = computeChatFrontier([record(3, 0), record(3, 9_007_199_254_740_990)]);

        expect(Date.now() - started).toBeLessThan(1_000);
        expect(frontier[0]).toMatchObject({ contiguous: 0, highest: 9_007_199_254_740_990 });
        expect(frontier[0].holes).toEqual([{ from: 1, to: 9_007_199_254_740_989 }]);
    });

    it('reports every gap between what it holds', () => {
        const frontier = computeChatFrontier([record(3, 0), record(3, 3), record(3, 4), record(3, 8)]);

        expect(frontier[0].holes).toEqual([
            { from: 1, to: 2 },
            { from: 5, to: 7 },
        ]);
    });
});

describe('missingForPeer', () => {
    it('asks for everything when the peer knows nothing of an author', () => {
        const own = computeChatFrontier([record(3, 0), record(3, 1)]);

        expect(missingForPeer([], own)).toEqual([{ author: AUTHOR, from: 0, to: 1 }]);
    });

    it('serves what sits above the last hole -- the case a contiguous-only bound dropped', () => {
        const own = computeChatFrontier([record(3, 0), record(3, 1), record(3, 3)]);
        const peer = computeChatFrontier([record(3, 0), record(3, 1)]);

        expect(missingForPeer(peer, own)).toEqual([{ author: AUTHOR, from: 2, to: 3 }]);
    });

    it('asks for nothing when the peer is level', () => {
        const own = computeChatFrontier([record(3, 0), record(3, 1)]);

        expect(missingForPeer(own, own)).toEqual([]);
    });

    it('asks for nothing when the peer is ahead', () => {
        const own = computeChatFrontier([record(3, 0)]);
        const peer = computeChatFrontier([record(3, 0), record(3, 1)]);

        expect(missingForPeer(peer, own)).toEqual([]);
    });
});

describe('a frontier with more holes than the wire format carries', () => {
    const fragmented = Array.from({ length: 200 }, (_, index) => index * 2).map((sequence) => record(3, sequence));

    it('stops claiming what it could not describe, so the gaps stay requestable', () => {
        const own = computeChatFrontier(fragmented);

        expect(own[0].holes).toHaveLength(64);
        expect(own[0].highest).toBe(own[0].holes[63].to + 1);
    });

    it('lets a complete peer resend everything above the last hole it was told about', () => {
        const peer = computeChatFrontier(fragmented);
        const complete = computeChatFrontier(Array.from({ length: 400 }, (_, index) => record(3, index)));

        const wanted = missingForPeer(peer, complete);
        const covered = new Set(
            wanted.flatMap(({ from, to }) => Array.from({ length: to - from + 1 }, (_, step) => from + step)),
        );

        for (let sequence = 1; sequence < 399; sequence += 2) expect(covered.has(sequence)).toBe(true);
    });
});

describe('clampOwnAuthorFrontier', () => {
    it('advertises the authoring position of this member even with nothing stored', () => {
        const clamped = clampOwnAuthorFrontier(computeChatFrontier([], [], [AUTHOR]), AUTHOR, 5);

        expect(clamped[0]).toMatchObject({ contiguous: 4, highest: 4 });
    });

    it('leaves a lost tail visible, so a peer that still holds it pushes it back', () => {
        const frontier = computeChatFrontier([record(3, 0), record(3, 1)]);
        const clamped = clampOwnAuthorFrontier(frontier, AUTHOR, 5);
        const complete = computeChatFrontier(Array.from({ length: 5 }, (_, index) => record(3, index)));

        expect(clamped[0]).toMatchObject({ contiguous: 1, highest: 1 });
        expect(missingForPeer(clamped, complete)).toEqual([{ author: AUTHOR, from: 2, to: 4 }]);
    });

    it('leaves an author with a hole alone, because the gap is what has to be repaired', () => {
        const frontier = computeChatFrontier([record(3, 0), record(3, 2)]);

        expect(clampOwnAuthorFrontier(frontier, AUTHOR, 3)).toEqual(frontier);
    });
});

describe('the frontier wire format', () => {
    it('survives a round trip for what it carries', () => {
        const frontier = computeChatFrontier([record(3, 0), record(3, 1), record(3, 3)]);
        const decoded = decodeChatFrontier(encodeChatFrontier(frontier));

        expect(decoded[0].author).toBe(frontier[0].author);
        expect(decoded[0].contiguous).toBe(frontier[0].contiguous);
        expect(decoded[0].holes).toEqual(frontier[0].holes);
    });

    it('carries the highest sequence held, so a peer knows what sits above the last hole', () => {
        const frontier = computeChatFrontier([record(3, 0), record(3, 5)]);

        expect(decodeChatFrontier(encodeChatFrontier(frontier))[0].highest).toBe(5);
    });

    it('refuses a frontier whose highest sits below its contiguous run', () => {
        const bytes = encodeChatFrontier(computeChatFrontier([record(3, 0), record(3, 1)]));
        bytes[23] = 0;

        expect(() => decodeChatFrontier(bytes)).toThrow();
    });
});

describe('what a peer already holds', () => {
    it('resumes above what the peer reports as its highest, not above its last hole', () => {
        const own = computeChatFrontier([0, 1, 2, 3, 4, 5].map((sequence) => record(3, sequence)));
        const peer = computeChatFrontier([record(3, 0), record(3, 1), record(3, 4), record(3, 5)]);

        expect(missingForPeer(peer, own)).toEqual([{ author: AUTHOR, from: 2, to: 3 }]);
    });
});

describe('a frontier from an untrusted peer', () => {
    it('refuses a hole that reaches above the head the peer claims', () => {
        const frontier = computeChatFrontier([record(3, 0), record(3, 2)]);
        const encoded = encodeChatFrontier([{ ...frontier[0], holes: [{ from: 1, to: Number.MAX_SAFE_INTEGER }] }]);

        expect(() => decodeChatFrontier(encoded)).toThrow(/above the head it claims/);
    });

    it('never asks this member for more than it holds', () => {
        const complete = computeChatFrontier([record(3, 0), record(3, 1), record(3, 2)]);
        const greedy = [{ ...complete[0], contiguous: 0, highest: 0, holes: [{ from: 1, to: 9_000 }] }];

        expect(missingForPeer(greedy, complete)).toEqual([{ author: AUTHOR, from: 1, to: 2 }]);
    });
});
