import {
    compareHybridLogicalTime,
    MAX_ACCEPTED_FUTURE_SKEW_MS,
    nextLocalHybridLogicalTime,
    observeRemoteHybridLogicalTime,
    requireAcceptableRemoteHybridLogicalTime,
} from '../src/mls/hybridLogicalClock';

describe('compareHybridLogicalTime', () => {
    it('orders by the physical part first and the counter second', () => {
        expect(compareHybridLogicalTime({ physical: 2, counter: 0 }, { physical: 1, counter: 9 })).toBeGreaterThan(0);
        expect(compareHybridLogicalTime({ physical: 1, counter: 2 }, { physical: 1, counter: 1 })).toBeGreaterThan(0);
        expect(compareHybridLogicalTime({ physical: 1, counter: 1 }, { physical: 1, counter: 1 })).toBe(0);
    });
});

describe('nextLocalHybridLogicalTime', () => {
    it('follows the wall clock when it has moved past what was observed', () => {
        expect(nextLocalHybridLogicalTime({ physical: 100, counter: 5 }, 200)).toEqual({ physical: 200, counter: 0 });
    });

    it('bumps the counter instead of the clock when the wall clock has not moved', () => {
        expect(nextLocalHybridLogicalTime({ physical: 200, counter: 5 }, 200)).toEqual({ physical: 200, counter: 6 });
    });

    it('never goes backwards when the wall clock does', () => {
        expect(nextLocalHybridLogicalTime({ physical: 300, counter: 1 }, 200)).toEqual({ physical: 300, counter: 2 });
    });
});

describe('observeRemoteHybridLogicalTime', () => {
    it('takes the highest of what is known and what arrived', () => {
        expect(
            observeRemoteHybridLogicalTime({ physical: 100, counter: 1 }, { physical: 150, counter: 0 }, 120),
        ).toEqual({ physical: 150, counter: 1 });
    });
});

describe('requireAcceptableRemoteHybridLogicalTime', () => {
    it('accepts a time inside the skew window', () => {
        expect(() =>
            requireAcceptableRemoteHybridLogicalTime(
                { physical: 1_000 + MAX_ACCEPTED_FUTURE_SKEW_MS, counter: 0 },
                1_000,
            ),
        ).not.toThrow();
    });

    it('rejects a time beyond the window instead of clamping it, because the value is inside the event hash', () => {
        expect(() =>
            requireAcceptableRemoteHybridLogicalTime(
                { physical: 1_001 + MAX_ACCEPTED_FUTURE_SKEW_MS, counter: 0 },
                1_000,
            ),
        ).toThrow();
    });
});
