import { ConversationId, MemberNumber, toMemberNumber } from '../types/conversation';
import { MlsWorkerClient } from './MlsWorkerClient';
import { sameBytes } from './byteCodec';
import {
    DirectMlsBootstrapFrame,
    DirectMlsMembership,
    MlsRosterMember,
    encodeDirectMlsWireFrame,
    tryDecodeDirectMlsBootstrapFrame,
} from './directBootstrapProtocol';

export type MlsInviteResult = {
    routingId: Uint8Array;
    epoch: bigint;
    membership: DirectMlsMembership;
};

type OwnerOptions = {
    conversationId: ConversationId;
    routingId: Uint8Array;
    membership: DirectMlsMembership;
    invitee: MlsRosterMember;
    mls: MlsWorkerClient;
    serialize: <T>(task: () => Promise<T>) => Promise<T>;
    sendToInvitee: (frame: Uint8Array) => void;
    sendCommitToMembers: (commit: Uint8Array) => Promise<void> | void;
    /** The owner merges the invitee into whatever roster it holds when the commit lands, not into a stale snapshot. */
    onRosterChanged: (epoch: bigint) => void;
    onInviteeJoined: () => void;
};

type JoinerOptions = {
    conversationId: ConversationId;
    ownPublicKey: string;
    mls: MlsWorkerClient;
    send: (frame: Uint8Array) => void;
    onJoined: (result: MlsInviteResult) => void;
};

export function nextMemberNumber(roster: ReadonlyArray<{ memberNumber: MemberNumber }>): MemberNumber {
    const highest = roster.reduce((max, member) => Math.max(max, Number(member.memberNumber)), -1);
    return toMemberNumber(highest + 1);
}

export class MlsInviteOwnerSession {
    private readonly options: OwnerOptions;
    private staging: Promise<Uint8Array> | undefined;
    private invitation: Uint8Array | undefined;

    constructor(options: OwnerOptions) {
        this.options = options;
    }

    /** Replays the invite on every call: an invitee that missed it has nothing else to wake it up. */
    invite(): void {
        const { routingId, membership, invitee } = this.options;
        this.options.sendToInvitee(
            encodeDirectMlsWireFrame({
                kind: 'invite',
                routingId,
                memberNumber: invitee.memberNumber,
                owner: membership.owner,
                roster: membership.roster,
            }),
        );
    }

    async receive(bytes: Uint8Array): Promise<void> {
        const frame = tryDecodeDirectMlsBootstrapFrame(bytes);
        if (frame === undefined) return;
        if (frame.kind === 'keyPackage') return await this.addMember(frame);
        if (frame.kind === 'joined') {
            this.options.onInviteeJoined();
        }
    }

    private async addMember(frame: Extract<DirectMlsBootstrapFrame, { kind: 'keyPackage' }>): Promise<void> {
        if (this.invitation !== undefined) {
            this.options.sendToInvitee(this.invitation);
            return;
        }
        if (this.staging === undefined) this.staging = this.stage(frame);
        this.options.sendToInvitee(await this.staging);
    }

    private async stage(frame: Extract<DirectMlsBootstrapFrame, { kind: 'keyPackage' }>): Promise<Uint8Array> {
        const { conversationId, routingId, invitee, mls } = this.options;
        try {
            return await this.options.serialize(async () => {
                const staged = await mls.stageAddMember(
                    conversationId,
                    frame.keyPackage,
                    undefined,
                    invitee.memberNumber,
                );
                await mls.mergePendingCommit(conversationId);
                this.invitation = encodeDirectMlsWireFrame({
                    kind: 'addMember',
                    routingId,
                    commit: staged.commit,
                    welcome: staged.welcome,
                });
                const epoch = (await mls.inspect(conversationId)).epoch ?? 0n;
                // The roster is recorded before the members are told: a failed send is recovered by the commit tail,
                // an unrecorded roster is not recovered at all, because a retry replays the invitation and stops.
                this.options.onRosterChanged(epoch);
                await this.options.sendCommitToMembers(staged.commit);
                return this.invitation;
            });
        } catch (error) {
            if (this.invitation === undefined) this.staging = undefined;
            throw error;
        }
    }
}

export class MlsInviteJoinerSession {
    private readonly options: JoinerOptions;
    private invited: Extract<DirectMlsBootstrapFrame, { kind: 'invite' }> | undefined;
    private keyPackageFrame: Uint8Array | undefined;
    private preparing: Promise<void> | undefined;
    private joined = false;

    constructor(options: JoinerOptions) {
        this.options = options;
    }

    async receive(bytes: Uint8Array): Promise<boolean> {
        const frame = tryDecodeDirectMlsBootstrapFrame(bytes);
        if (frame === undefined) return false;
        if (frame.kind === 'invite') {
            await this.acceptInvite(frame);
            return true;
        }
        if (frame.kind === 'addMember' && this.invited !== undefined) {
            await this.join(frame);
            return true;
        }
        return false;
    }

    private async acceptInvite(frame: Extract<DirectMlsBootstrapFrame, { kind: 'invite' }>): Promise<void> {
        if (this.joined) return;
        if (this.invited !== undefined) {
            if (!sameBytes(this.invited.routingId, frame.routingId)) {
                throw new Error('MLS invite routing ID does not match the one this member accepted');
            }
            if (this.keyPackageFrame !== undefined) {
                this.options.send(this.keyPackageFrame);
                return;
            }
            /** A replayed invite is the only thing that wakes this member, so a failed attempt is retried here. */
            if (this.preparing !== undefined) return;
        }
        // The inviter names the number this member is to take; a number already seated, or the owner's, would
        // leave this member absent from its own membership and silently unable to reconcile.
        if (frame.roster.some((member) => Number(member.memberNumber) === Number(frame.memberNumber))) {
            throw new Error('MLS invite assigned a member number that is already seated in the group');
        }
        if (Number(frame.memberNumber) === Number(frame.owner)) {
            throw new Error('MLS invite assigned this member the owner number');
        }
        this.invited = frame;
        const prepared = this.prepareKeyPackage(frame);
        this.preparing = prepared;
        try {
            await prepared;
        } finally {
            if (this.preparing === prepared) this.preparing = undefined;
        }
    }

    private async prepareKeyPackage(frame: Extract<DirectMlsBootstrapFrame, { kind: 'invite' }>): Promise<void> {
        const { conversationId, mls } = this.options;
        await mls.initialize(conversationId, frame.memberNumber);
        const keyPackage = await mls.createKeyPackage(conversationId);
        this.keyPackageFrame = encodeDirectMlsWireFrame({
            kind: 'keyPackage',
            routingId: frame.routingId,
            keyPackage,
        });
        this.options.send(this.keyPackageFrame);
    }

    private async join(frame: Extract<DirectMlsBootstrapFrame, { kind: 'addMember' }>): Promise<void> {
        if (this.joined) return;
        const invited = this.invited;
        if (invited === undefined) return;
        this.joined = true;
        const { conversationId, mls, ownPublicKey } = this.options;
        let epoch: bigint;
        try {
            epoch = await mls.joinFromWelcome(conversationId, frame.welcome);
        } catch (error) {
            this.joined = false;
            throw error;
        }
        const roster = [...invited.roster];
        if (!roster.some((member) => member.memberNumber === invited.memberNumber)) {
            roster.push({ memberNumber: invited.memberNumber, publicKey: ownPublicKey, joinedEpoch: epoch.toString() });
        }
        roster.sort((left, right) => Number(left.memberNumber) - Number(right.memberNumber));
        this.options.send(encodeDirectMlsWireFrame({ kind: 'joined', routingId: invited.routingId, epoch }));
        this.options.onJoined({
            routingId: invited.routingId,
            epoch,
            membership: {
                role: 'invitee',
                ownMemberNumber: invited.memberNumber,
                owner: invited.owner,
                roster,
            },
        });
    }
}
