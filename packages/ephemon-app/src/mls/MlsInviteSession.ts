import { ConversationId, MemberNumber, toMemberNumber } from '../types/conversation';
import { MlsWorkerClient } from './MlsWorkerClient';
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
    sendCommitToMembers: (commit: Uint8Array) => void;
    onRosterChanged: (roster: ReadonlyArray<MlsRosterMember>, epoch: bigint) => void;
    onInviteeJoined: () => void;
};

type JoinerOptions = {
    conversationId: ConversationId;
    ownPublicKey: string;
    mls: MlsWorkerClient;
    send: (frame: Uint8Array) => void;
    onJoined: (result: MlsInviteResult) => void;
};

export function nextMemberNumber(roster: ReadonlyArray<MlsRosterMember>): MemberNumber {
    const highest = roster.reduce((max, member) => Math.max(max, Number(member.memberNumber)), -1);
    return toMemberNumber(highest + 1);
}

export class MlsInviteOwnerSession {
    private readonly options: OwnerOptions;
    private staged = false;
    private invited = false;
    private accepted = false;

    constructor(options: OwnerOptions) {
        this.options = options;
    }

    invite(): void {
        if (this.invited) return;
        this.invited = true;
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

    get pending(): boolean {
        return !this.accepted;
    }

    async receive(bytes: Uint8Array): Promise<void> {
        const frame = tryDecodeDirectMlsBootstrapFrame(bytes);
        if (frame === undefined) return;
        if (frame.kind === 'keyPackage') return await this.addMember(frame);
        if (frame.kind === 'joined') {
            this.accepted = true;
            this.options.onInviteeJoined();
        }
    }

    private async addMember(frame: Extract<DirectMlsBootstrapFrame, { kind: 'keyPackage' }>): Promise<void> {
        if (this.staged) return;
        this.staged = true;
        const { conversationId, routingId, membership, invitee, mls } = this.options;
        const { commit, welcome } = await this.options.serialize(async () => {
            const staged = await mls.stageAddMember(conversationId, frame.keyPackage);
            await mls.mergePendingCommit(conversationId);
            return staged;
        });
        const roster = [...membership.roster, invitee].sort(
            (left, right) => Number(left.memberNumber) - Number(right.memberNumber),
        );
        const epoch = (await mls.inspect(conversationId)).epoch ?? 0n;
        this.options.onRosterChanged(roster, epoch);
        this.options.sendToInvitee(encodeDirectMlsWireFrame({ kind: 'addMember', routingId, commit, welcome }));
        this.options.sendCommitToMembers(commit);
    }
}

export class MlsInviteJoinerSession {
    private readonly options: JoinerOptions;
    private invited: Extract<DirectMlsBootstrapFrame, { kind: 'invite' }> | undefined;
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
        this.invited = frame;
        const { conversationId, mls } = this.options;
        await mls.initialize(conversationId, frame.memberNumber);
        const keyPackage = await mls.createKeyPackage(conversationId);
        this.options.send(encodeDirectMlsWireFrame({ kind: 'keyPackage', routingId: frame.routingId, keyPackage }));
    }

    private async join(frame: Extract<DirectMlsBootstrapFrame, { kind: 'addMember' }>): Promise<void> {
        if (this.joined) return;
        const invited = this.invited;
        if (invited === undefined) return;
        this.joined = true;
        const { conversationId, mls, ownPublicKey } = this.options;
        const epoch = await mls.joinFromWelcome(conversationId, frame.welcome);
        const roster = [...invited.roster];
        if (!roster.some((member) => member.memberNumber === invited.memberNumber)) {
            roster.push({ memberNumber: invited.memberNumber, publicKey: ownPublicKey });
        }
        roster.sort((left, right) => Number(left.memberNumber) - Number(right.memberNumber));
        this.options.send(encodeDirectMlsWireFrame({ kind: 'joined', routingId: invited.routingId, epoch }));
        this.options.onJoined({
            routingId: invited.routingId,
            epoch,
            membership: {
                role: 'invitee',
                ownMemberNumber: invited.memberNumber,
                peerMemberNumber: invited.owner,
                owner: invited.owner,
                roster,
            },
        });
    }
}
