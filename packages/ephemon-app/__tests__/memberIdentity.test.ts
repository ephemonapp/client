import { decodeIdentities, identityOf, memberNumberOf, memberNumbersOf } from '../src/mls/memberIdentity';
import { toMemberNumber } from '../src/types/conversation';

describe('member identity', () => {
    it('round trips a member number', () => {
        expect(Number(memberNumberOf(identityOf(toMemberNumber(7))))).toBe(7);
    });

    it('is four bytes, big-endian', () => {
        expect(Array.from(identityOf(toMemberNumber(258)))).toEqual([0, 0, 1, 2]);
    });

    it('refuses an identity of another length, rather than guessing a number', () => {
        expect(() => memberNumberOf(Uint8Array.of(1, 2))).toThrow();
        expect(() => memberNumberOf(Uint8Array.of(0, 0, 0, 1, 0))).toThrow();
    });

    it('splits the list the facade hands out by its lengths', () => {
        const bytes = Uint8Array.from([...identityOf(toMemberNumber(0)), ...identityOf(toMemberNumber(3))]);

        expect(decodeIdentities(bytes, [4, 4])).toHaveLength(2);
        expect(memberNumbersOf(bytes, [4, 4]).map(Number)).toEqual([0, 3]);
    });

    it('decodes an empty list', () => {
        expect(memberNumbersOf(new Uint8Array(), [])).toEqual([]);
    });

    it('refuses lengths that do not cover the bytes exactly', () => {
        const bytes = identityOf(toMemberNumber(1));

        expect(() => decodeIdentities(bytes, [8])).toThrow(/truncated/);
        expect(() => decodeIdentities(bytes, [2])).toThrow(/trailing/);
    });
});
