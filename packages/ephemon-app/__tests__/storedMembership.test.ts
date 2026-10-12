import { membershipFrom, rosterFrom } from '../src/mls/storedMembership';
import { toMemberNumber } from '../src/types/conversation';

const stored = {
    owner: toMemberNumber(0),
    ownMemberNumber: toMemberNumber(2),
    roster: [
        { memberNumber: 0, publicKey: 'owner-key', name: 'Owner', joinedEpoch: '0' },
        { memberNumber: 2, publicKey: 'own-key', serverUrl: 'https://s.example' },
    ],
};

describe('the stored membership decoder', () => {
    it('restores a member that is not the owner as an invitee', () => {
        const membership = membershipFrom(stored);

        expect(membership.role).toBe('invitee');
        expect(Number(membership.ownMemberNumber)).toBe(2);
        expect(Number(membership.owner)).toBe(0);
    });

    it('restores the owner of its own group as the creator', () => {
        const membership = membershipFrom({ ...stored, ownMemberNumber: toMemberNumber(0) });

        expect(membership.role).toBe('creator');
    });

    it('carries every roster field through, member numbers branded', () => {
        const [owner, own] = rosterFrom(stored.roster);

        expect(owner).toEqual({
            memberNumber: toMemberNumber(0),
            publicKey: 'owner-key',
            name: 'Owner',
            joinedEpoch: '0',
            serverUrl: undefined,
        });
        expect(own.serverUrl).toBe('https://s.example');
        expect(typeof own.memberNumber).toBe('number');
    });

    it('accepts a roster the caller adjusted, which is how a member renames itself offline', () => {
        const roster = rosterFrom(stored.roster).map((member) =>
            Number(member.memberNumber) === 2 ? { ...member, name: 'Renamed' } : member,
        );

        expect(membershipFrom(stored, roster).roster[1].name).toBe('Renamed');
    });

    it('restores an empty roster rather than failing', () => {
        expect(membershipFrom({ ...stored, roster: undefined }).roster).toEqual([]);
    });
});
