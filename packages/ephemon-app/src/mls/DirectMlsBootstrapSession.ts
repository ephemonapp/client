import { ConversationId } from '../types/conversation';
import { MlsWorkerClient } from './MlsWorkerClient';
import {
    DIRECT_MLS_BOOTSTRAP_VERSION,
    DirectMlsBootstrapFrame,
    DirectMlsMembership,
    encodeDirectMlsBootstrapFrame,
    tryDecodeDirectMlsBootstrapFrame,
} from './directBootstrapProtocol';

export type DirectMlsBootstrapResult = {
    routingId: Uint8Array;
    epoch: bigint;
    membership: DirectMlsMembership;
};

export type DirectMlsBootstrapPhase =
    | 'idle'
    | 'awaiting-initialize'
    | 'awaiting-key-package'
    | 'awaiting-add-member'
    | 'awaiting-joined'
    | 'awaiting-complete'
    | 'complete';

type DirectMlsBootstrapSessionOptions = {
    conversationId: ConversationId;
    membership: DirectMlsMembership;
    mls: MlsWorkerClient;
    send: (frame: Uint8Array) => void;
    onComplete?: (result: DirectMlsBootstrapResult) => void;
    randomBytes?: (byteLength: number) => Uint8Array;
};

function defaultRandomBytes(byteLength: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(byteLength));
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.byteLength !== right.byteLength) return false;
    return left.every((value, index) => value === right[index]);
}

function requireRoutingId(frame: DirectMlsBootstrapFrame): Uint8Array {
    if (frame.kind === 'hello') throw new Error('MLS bootstrap hello has no routing ID');
    return frame.routingId;
}

/**
 * Resumable two-member MLS bootstrap over an already authenticated Ephemon link.
 *
 * The latest outbound frame is stored atomically beside the OpenMLS checkpoint.
 * Repeated or lost link delivery is recovered by exchanging hello and replaying
 * that frame; no transport public key is written to the wire or checkpoint companion.
 */
export class DirectMlsBootstrapSession {
    private readonly conversationId: ConversationId;
    private readonly membership: DirectMlsMembership;
    private readonly mls: MlsWorkerClient;
    private readonly sendFrame: (frame: Uint8Array) => void;
    private readonly onComplete?: (result: DirectMlsBootstrapResult) => void;
    private readonly randomBytes: (byteLength: number) => Uint8Array;
    private queue: Promise<unknown> = Promise.resolve();
    private started = false;
    private completionNotified = false;
    private companion: DirectMlsBootstrapFrame | undefined;

    constructor(options: DirectMlsBootstrapSessionOptions) {
        this.conversationId = options.conversationId;
        this.membership = options.membership;
        this.mls = options.mls;
        this.sendFrame = options.send;
        this.onComplete = options.onComplete;
        this.randomBytes = options.randomBytes ?? defaultRandomBytes;
    }

    start(): Promise<void> {
        return this.serial(async () => {
            if (this.started) return;
            await this.initialize();
            this.sendHello();
        });
    }

    linkOpened(): Promise<void> {
        return this.serial(async () => {
            if (!this.started) await this.initialize();
            this.sendHello();
        });
    }

    private async initialize(): Promise<void> {
        await this.mls.initialize(this.conversationId, this.membership.ownMemberNumber);
        const encodedCompanion = this.mls.getCheckpointCompanion(this.conversationId);
        try {
            this.companion =
                encodedCompanion === undefined ? undefined : tryDecodeDirectMlsBootstrapFrame(encodedCompanion);
        } finally {
            encodedCompanion?.fill(0);
        }
        if (encodedCompanion !== undefined && this.companion === undefined) {
            throw new Error('MLS checkpoint companion is not a bootstrap frame');
        }
        this.validatePersistedPhase();
        this.started = true;
        if (this.companion?.kind === 'complete') this.notifyComplete(this.companion);
    }

    receive(bytes: Uint8Array): Promise<boolean> {
        const frame = tryDecodeDirectMlsBootstrapFrame(Uint8Array.from(bytes));
        if (frame === undefined) return Promise.resolve(false);
        return this.serial(async () => {
            if (!this.started) throw new Error('Direct MLS bootstrap session has not been started');
            await this.handle(frame);
            return true;
        });
    }

    get phase(): DirectMlsBootstrapPhase {
        if (this.completionNotified) return 'complete';
        switch (this.companion?.kind) {
            case undefined:
                return this.membership.role === 'creator' ? 'idle' : 'awaiting-initialize';
            case 'initialize':
                return 'awaiting-key-package';
            case 'keyPackage':
                return 'awaiting-add-member';
            case 'addMember':
                return 'awaiting-joined';
            case 'joined':
                return 'awaiting-complete';
            case 'complete':
                return 'complete';
            case 'hello':
                throw new Error('A hello frame cannot be a persisted MLS bootstrap phase');
        }
    }

    private async handle(frame: DirectMlsBootstrapFrame): Promise<void> {
        switch (frame.kind) {
            case 'hello':
                await this.handleHello(frame);
                return;
            case 'initialize':
                await this.handleInitialize(frame);
                return;
            case 'keyPackage':
                await this.handleKeyPackage(frame);
                return;
            case 'addMember':
                await this.handleAddMember(frame);
                return;
            case 'joined':
                await this.handleJoined(frame);
                return;
            case 'complete':
                await this.handleComplete(frame);
                return;
        }
    }

    private async handleHello(frame: Extract<DirectMlsBootstrapFrame, { kind: 'hello' }>): Promise<void> {
        if (
            frame.minimumVersion > DIRECT_MLS_BOOTSTRAP_VERSION ||
            frame.maximumVersion < DIRECT_MLS_BOOTSTRAP_VERSION ||
            frame.minimumVersion > frame.maximumVersion
        ) {
            throw new Error('Peer does not support the direct MLS bootstrap version');
        }
        if (this.companion !== undefined) {
            this.send(this.companion);
            return;
        }
        if (this.membership.role === 'invitee') return;

        const routingId = this.requireRandomBytes(32, 'routing ID');
        const groupId = this.requireRandomBytes(32, 'MLS group ID');
        const initialize: DirectMlsBootstrapFrame = { kind: 'initialize', routingId, groupId };
        const encoded = encodeDirectMlsBootstrapFrame(initialize);
        await this.mls.createGroup(this.conversationId, groupId, encoded);
        this.companion = initialize;
        this.send(initialize);
    }

    private async handleInitialize(frame: Extract<DirectMlsBootstrapFrame, { kind: 'initialize' }>): Promise<void> {
        this.requireRole('invitee', frame.kind);
        if (this.companion !== undefined) {
            this.requireSameRoutingId(frame);
            this.send(this.companion);
            return;
        }
        let keyPackageFrame: Extract<DirectMlsBootstrapFrame, { kind: 'keyPackage' }> | undefined;
        await this.mls.createKeyPackage(this.conversationId, (keyPackage) => {
            keyPackageFrame = { kind: 'keyPackage', routingId: frame.routingId, keyPackage };
            return encodeDirectMlsBootstrapFrame(keyPackageFrame);
        });
        if (keyPackageFrame === undefined) throw new Error('MLS KeyPackage was not produced');
        this.companion = keyPackageFrame;
        this.send(keyPackageFrame);
    }

    private async handleKeyPackage(frame: Extract<DirectMlsBootstrapFrame, { kind: 'keyPackage' }>): Promise<void> {
        this.requireRole('creator', frame.kind);
        this.requireSameRoutingId(frame);
        if (this.companion?.kind === 'addMember' || this.companion?.kind === 'complete') {
            this.send(this.companion);
            return;
        }
        if (this.companion?.kind !== 'initialize') this.unexpected(frame.kind);

        let addMemberFrame: Extract<DirectMlsBootstrapFrame, { kind: 'addMember' }> | undefined;
        await this.mls.stageAddMember(this.conversationId, frame.keyPackage, ({ commit, welcome }) => {
            addMemberFrame = {
                kind: 'addMember',
                routingId: frame.routingId,
                commit,
                welcome,
            };
            return encodeDirectMlsBootstrapFrame(addMemberFrame);
        });
        if (addMemberFrame === undefined) throw new Error('MLS add-member artifacts were not produced');
        this.companion = addMemberFrame;
        this.send(addMemberFrame);
    }

    private async handleAddMember(frame: Extract<DirectMlsBootstrapFrame, { kind: 'addMember' }>): Promise<void> {
        this.requireRole('invitee', frame.kind);
        this.requireSameRoutingId(frame);
        if (this.companion?.kind === 'joined') {
            this.send(this.companion);
            return;
        }
        if (this.companion?.kind !== 'keyPackage') this.unexpected(frame.kind);

        let joinedFrame: Extract<DirectMlsBootstrapFrame, { kind: 'joined' }> | undefined;
        await this.mls.joinFromWelcome(this.conversationId, frame.welcome, (epoch) => {
            joinedFrame = { kind: 'joined', routingId: frame.routingId, epoch };
            return encodeDirectMlsBootstrapFrame(joinedFrame);
        });
        if (joinedFrame === undefined) throw new Error('MLS Welcome did not produce a joined epoch');
        this.companion = joinedFrame;
        this.send(joinedFrame);
    }

    private async handleJoined(frame: Extract<DirectMlsBootstrapFrame, { kind: 'joined' }>): Promise<void> {
        this.requireRole('creator', frame.kind);
        this.requireSameRoutingId(frame);
        if (this.companion?.kind === 'complete') {
            if (this.companion.epoch !== frame.epoch) throw new Error('Peer acknowledged a different MLS epoch');
            this.send(this.companion);
            return;
        }
        if (this.companion?.kind !== 'addMember') this.unexpected(frame.kind);

        let completeFrame: Extract<DirectMlsBootstrapFrame, { kind: 'complete' }> | undefined;
        await this.mls.mergePendingCommit(this.conversationId, (epoch) => {
            if (epoch !== frame.epoch) throw new Error('Peer joined a different MLS epoch');
            completeFrame = { kind: 'complete', routingId: frame.routingId, epoch };
            return encodeDirectMlsBootstrapFrame(completeFrame);
        });
        if (completeFrame === undefined) throw new Error('MLS pending commit did not produce a completed epoch');
        this.companion = completeFrame;
        this.notifyComplete(completeFrame);
        this.send(completeFrame);
    }

    private async handleComplete(frame: Extract<DirectMlsBootstrapFrame, { kind: 'complete' }>): Promise<void> {
        this.requireRole('invitee', frame.kind);
        this.requireSameRoutingId(frame);
        if (this.companion?.kind !== 'joined') this.unexpected(frame.kind);
        if (this.companion.epoch !== frame.epoch) throw new Error('Creator completed a different MLS epoch');
        const inspection = await this.mls.inspect(this.conversationId);
        if (inspection.epoch !== frame.epoch) throw new Error('Completed MLS epoch does not match local state');
        this.notifyComplete(frame);
    }

    private validatePersistedPhase(): void {
        if (this.companion?.kind === 'hello') throw new Error('MLS checkpoint persisted a transient hello frame');
        if (this.companion === undefined) return;
        const creatorPhase =
            this.companion.kind === 'initialize' ||
            this.companion.kind === 'addMember' ||
            this.companion.kind === 'complete';
        if ((this.membership.role === 'creator') !== creatorPhase) {
            throw new Error('MLS checkpoint bootstrap phase does not match the local member role');
        }
    }

    private requireSameRoutingId(frame: Exclude<DirectMlsBootstrapFrame, { kind: 'hello' }>): void {
        if (this.companion === undefined) this.unexpected(frame.kind);
        if (!sameBytes(requireRoutingId(this.companion), frame.routingId)) {
            throw new Error('MLS bootstrap routing ID does not match the persisted conversation');
        }
    }

    private requireRole(role: DirectMlsMembership['role'], frameKind: DirectMlsBootstrapFrame['kind']): void {
        if (this.membership.role !== role) throw new Error(`${frameKind} is invalid for the ${this.membership.role}`);
    }

    private unexpected(frameKind: DirectMlsBootstrapFrame['kind']): never {
        throw new Error(`Unexpected ${frameKind} during MLS bootstrap phase ${this.phase}`);
    }

    private requireRandomBytes(byteLength: number, field: string): Uint8Array {
        const bytes = this.randomBytes(byteLength);
        if (bytes.byteLength !== byteLength) throw new Error(`Random ${field} must contain ${byteLength} bytes`);
        return Uint8Array.from(bytes);
    }

    private send(frame: DirectMlsBootstrapFrame): void {
        this.sendFrame(encodeDirectMlsBootstrapFrame(frame));
    }

    private sendHello(): void {
        this.send({
            kind: 'hello',
            minimumVersion: DIRECT_MLS_BOOTSTRAP_VERSION,
            maximumVersion: DIRECT_MLS_BOOTSTRAP_VERSION,
        });
    }

    private notifyComplete(frame: Extract<DirectMlsBootstrapFrame, { kind: 'complete' }>): void {
        if (this.completionNotified) return;
        this.completionNotified = true;
        this.onComplete?.({
            routingId: Uint8Array.from(frame.routingId),
            epoch: frame.epoch,
            membership: this.membership,
        });
    }

    private serial<Result>(operation: () => Promise<Result>): Promise<Result> {
        const current = this.queue.catch(() => undefined).then(operation);
        this.queue = current;
        return current;
    }
}
