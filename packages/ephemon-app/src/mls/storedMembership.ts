import { MemberNumber, toMemberNumber } from '../types/conversation';
import { DirectMlsMembership, MlsRosterMember } from './directBootstrapProtocol';

export type StoredMlsRosterMember = {
    memberNumber: number;
    publicKey: string;
    serverUrl?: string;
    joinedEpoch?: string;
    name?: string;
};

export type StoredMlsBootstrap = {
    owner: MemberNumber;
    ownMemberNumber: MemberNumber;
    roster?: ReadonlyArray<StoredMlsRosterMember>;
};

export function rosterFrom(roster: ReadonlyArray<StoredMlsRosterMember> | undefined): Array<MlsRosterMember> {
    return (roster ?? []).map((member) => ({
        memberNumber: toMemberNumber(member.memberNumber),
        publicKey: member.publicKey,
        serverUrl: member.serverUrl,
        joinedEpoch: member.joinedEpoch,
        name: member.name,
    }));
}

/** The one other member of a two-party conversation, or undefined when the roster is not a pair. */
export function otherMemberNumber(membership: DirectMlsMembership): MemberNumber | undefined {
    const others = membership.roster.filter(
        (member) => Number(member.memberNumber) !== Number(membership.ownMemberNumber),
    );
    return others.length === 1 ? others[0].memberNumber : undefined;
}

/** The membership a restored conversation continues with, read from what the vault kept. */
export function membershipFrom(
    bootstrap: StoredMlsBootstrap,
    roster: ReadonlyArray<MlsRosterMember> = rosterFrom(bootstrap.roster),
): DirectMlsMembership {
    return {
        role: Number(bootstrap.owner) === Number(bootstrap.ownMemberNumber) ? 'creator' : 'invitee',
        ownMemberNumber: toMemberNumber(bootstrap.ownMemberNumber),
        owner: toMemberNumber(bootstrap.owner),
        roster,
    };
}
