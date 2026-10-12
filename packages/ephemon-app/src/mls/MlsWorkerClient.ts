import { ConversationId, MemberNumber } from '../types/conversation';
import { decodeIdentities, identityOf, memberNumberOf, memberNumbersOf } from './memberIdentity';
import { MlsCheckpointStore } from './mlsCheckpointStore';
import {
    DEFAULT_MLS_WASM_ASSET_URLS,
    MLS_WORKER_PROTOCOL_VERSION,
    MlsWasmAssetUrls,
    MlsWorkerCommand,
    MlsWorkerCommandResult,
    MlsWorkerErrorCode,
    MlsWorkerRequestPayload,
    MlsWorkerResponse,
    MlsWorkerSuccessResponse,
} from './protocol';

/** A failure raised inside the MLS worker, carrying the classification callers branch on. */
export class MlsWorkerError extends Error {
    readonly code: MlsWorkerErrorCode;

    constructor(message: string, code: MlsWorkerErrorCode) {
        super(message);
        this.name = 'MlsWorkerError';
        this.code = code;
    }
}

export function mlsErrorCode(error: unknown): MlsWorkerErrorCode {
    return error instanceof MlsWorkerError ? error.code : 'unknown';
}

/** Only a roster change can move a member's signature key; an application message cannot, and there are many of those. */
function rotatesSignatureKeys(command: MlsWorkerCommand['kind']): boolean {
    return command !== 'createApplicationMessage' && command !== 'processApplicationMessage';
}

function pairSignatureKeys(
    memberNumbers: ReadonlyArray<MemberNumber>,
    keys: ReadonlyArray<Uint8Array>,
): ReadonlyMap<number, Uint8Array> {
    if (memberNumbers.length !== keys.length) {
        throw new Error('The MLS roster and its signature keys disagree on member count');
    }
    return new Map(memberNumbers.map((memberNumber, index) => [Number(memberNumber), keys[index]]));
}

export type MlsGroupInspection = {
    memberNumber: MemberNumber;
    epoch?: bigint;
    memberNumbers?: ReadonlyArray<MemberNumber>;
    signatureKeys?: ReadonlyMap<number, Uint8Array>;
    epochAuthenticator?: Uint8Array;
};

/** What a commit says about itself; the app decides on these before it is kept. */
export type MlsCommitFacts = {
    senderMemberNumber: MemberNumber;
    senderIsMember: boolean;
    added: ReadonlyArray<MemberNumber>;
    removedLeaves: ReadonlyArray<number>;
    epoch: bigint;
};

export class MlsCommitRefusedError extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = 'MlsCommitRefusedError';
    }
}

type Session = {
    revision: number | null;
    unusable: boolean;
    companion?: Uint8Array;
    chain?: Uint8Array;
};

type PendingRpc = {
    resolve(response: MlsWorkerSuccessResponse): void;
    reject(error: Error): void;
};

export class MlsWorkerClient {
    private readonly worker: Worker;
    private readonly checkpointStore: MlsCheckpointStore;
    private readonly assets: MlsWasmAssetUrls;
    private readonly pending = new Map<number, PendingRpc>();
    private readonly sessions = new Map<ConversationId, Session>();
    private readonly queues = new Map<ConversationId, Promise<unknown>>();
    private readonly signatureKeys = new Map<ConversationId, ReadonlyMap<number, Uint8Array>>();
    private nextRequestId = 1;
    private fatalError: Error | undefined;

    constructor(
        checkpointStore: MlsCheckpointStore,
        worker: Worker = new Worker('/mls.worker.js', { name: 'ephemon-mls' }),
        assets: MlsWasmAssetUrls = DEFAULT_MLS_WASM_ASSET_URLS,
    ) {
        this.worker = worker;
        this.checkpointStore = checkpointStore;
        this.assets = assets;
        worker.onmessage = (event: MessageEvent<MlsWorkerResponse>) => {
            const response = event.data;
            if (response.protocolVersion !== MLS_WORKER_PROTOCOL_VERSION) {
                this.failFatally(new Error(`Unsupported MLS worker protocol ${response.protocolVersion}`));
                return;
            }
            const pending = this.pending.get(response.requestId);
            if (pending === undefined) return;
            this.pending.delete(response.requestId);
            if (response.ok) pending.resolve(response);
            else pending.reject(new MlsWorkerError(response.error, response.code));
        };
        worker.onerror = () => this.failFatally(new Error('MLS worker crashed'));
        worker.onmessageerror = () => this.failFatally(new Error('MLS worker returned an unreadable response'));
    }

    initialize(conversationId: ConversationId, memberNumber: MemberNumber): Promise<void> {
        return this.exclusive(conversationId, async () => {
            const existing = this.sessions.get(conversationId);
            if (existing !== undefined) existing.unusable = true;
            this.signatureKeys.delete(conversationId);
            const stored = await this.checkpointStore.load(conversationId);
            const companion = stored?.companion === undefined ? undefined : Uint8Array.from(stored.companion);
            const chain = stored?.chain === undefined ? undefined : Uint8Array.from(stored.chain);
            let adoptedCompanion = false;
            try {
                const response = await this.rpc({
                    kind: 'load',
                    conversationId,
                    identity: identityOf(memberNumber),
                    checkpoint: stored?.bytes,
                    assets: this.assets,
                });
                if (response.kind !== 'loaded') throw new Error(`Unexpected MLS worker response ${response.kind}`);
                if (Number(memberNumberOf(response.identity)) !== Number(memberNumber))
                    throw new Error('MLS worker loaded the wrong member identity');
                existing?.companion?.fill(0);
                existing?.chain?.fill(0);
                this.sessions.set(conversationId, {
                    revision: stored?.revision ?? null,
                    unusable: false,
                    companion,
                    chain,
                });
                adoptedCompanion = true;
            } finally {
                stored?.bytes.fill(0);
                stored?.companion?.fill(0);
                stored?.chain?.fill(0);
                if (!adoptedCompanion) {
                    companion?.fill(0);
                    chain?.fill(0);
                }
            }
        });
    }

    createGroup(conversationId: ConversationId, groupId: Uint8Array, checkpointCompanion?: Uint8Array): Promise<void> {
        return this.mutate(
            conversationId,
            { kind: 'createGroup', groupId },
            'groupCreated',
            checkpointCompanion === undefined ? undefined : () => checkpointCompanion,
        ).then(() => undefined);
    }

    createKeyPackage(
        conversationId: ConversationId,
        checkpointCompanion?: (keyPackage: Uint8Array) => Uint8Array,
    ): Promise<Uint8Array> {
        return this.mutate(
            conversationId,
            { kind: 'createKeyPackage' },
            'keyPackageCreated',
            checkpointCompanion === undefined ? undefined : (result) => checkpointCompanion(result.keyPackage),
        ).then((result) => result.keyPackage);
    }

    stageAddMember(
        conversationId: ConversationId,
        keyPackage: Uint8Array,
        checkpointCompanion?: (result: { commit: Uint8Array; welcome: Uint8Array }) => Uint8Array,
        expectedMemberNumber?: MemberNumber,
    ): Promise<{ claimedMemberNumber: MemberNumber; commit: Uint8Array; welcome: Uint8Array }> {
        return this.mutate(
            conversationId,
            { kind: 'stageAddMember', keyPackage },
            'memberAddStaged',
            checkpointCompanion === undefined
                ? undefined
                : ({ commit, welcome }) => checkpointCompanion({ commit, welcome }),
            undefined,
            (result) => {
                const claimed = memberNumberOf(result.claimedIdentity);
                if (expectedMemberNumber !== undefined && Number(claimed) !== Number(expectedMemberNumber)) {
                    throw new Error('MLS key package claims a member number the inviter did not assign');
                }
            },
        ).then(({ claimedIdentity, commit, welcome }) => ({
            claimedMemberNumber: memberNumberOf(claimedIdentity),
            commit,
            welcome,
        }));
    }

    mergePendingCommit(
        conversationId: ConversationId,
        checkpointCompanion?: (epoch: bigint) => Uint8Array,
    ): Promise<bigint> {
        return this.mutate(
            conversationId,
            { kind: 'mergePendingCommit' },
            'pendingCommitMerged',
            checkpointCompanion === undefined ? undefined : (result) => checkpointCompanion(BigInt(result.epoch)),
        ).then((result) => BigInt(result.epoch));
    }

    joinFromWelcome(
        conversationId: ConversationId,
        welcome: Uint8Array,
        checkpointCompanion?: (epoch: bigint) => Uint8Array,
    ): Promise<bigint> {
        return this.mutate(
            conversationId,
            { kind: 'joinFromWelcome', welcome },
            'welcomeJoined',
            checkpointCompanion === undefined ? undefined : (result) => checkpointCompanion(BigInt(result.epoch)),
        ).then((result) => BigInt(result.epoch));
    }

    createApplicationMessage(
        conversationId: ConversationId,
        payload: Uint8Array,
        checkpointChain?: Uint8Array,
    ): Promise<Uint8Array> {
        return this.mutate(
            conversationId,
            { kind: 'createApplicationMessage', payload },
            'applicationMessageCreated',
            undefined,
            checkpointChain,
        ).then((result) => result.message);
    }

    processApplicationMessage(
        conversationId: ConversationId,
        message: Uint8Array,
    ): Promise<{ senderMemberNumber: MemberNumber; senderIsMember: boolean; payload: Uint8Array }> {
        return this.mutate(
            conversationId,
            { kind: 'processApplicationMessage', message },
            'applicationMessageProcessed',
        ).then((result) => ({
            senderMemberNumber: memberNumberOf(result.senderIdentity),
            senderIsMember: result.senderIsMember,
            payload: result.payload,
        }));
    }

    createSelfUpdate(conversationId: ConversationId, checkpointChain?: Uint8Array): Promise<Uint8Array> {
        return this.mutate(
            conversationId,
            { kind: 'createSelfUpdate' },
            'selfUpdateCreated',
            undefined,
            checkpointChain,
        ).then((result) => result.commit);
    }

    /**
     * Applies a commit only if `refuse` returns no reason; a refusal rolls the worker back to before the commit and
     * throws that reason, so the conversation is left exactly as it was.
     */
    processIncomingCommit(
        conversationId: ConversationId,
        message: Uint8Array,
        refuse: (commit: MlsCommitFacts) => string | undefined,
    ): Promise<MlsCommitFacts> {
        let facts: MlsCommitFacts | undefined;
        return this.mutate(
            conversationId,
            { kind: 'processIncomingCommit', message },
            'commitProcessed',
            undefined,
            undefined,
            (result) => {
                facts = {
                    senderMemberNumber: memberNumberOf(result.senderIdentity),
                    senderIsMember: result.senderIsMember,
                    added: memberNumbersOf(result.added, result.addedLengths),
                    removedLeaves: result.removedLeaves,
                    epoch: BigInt(result.epoch),
                };
                const reason = refuse(facts);
                if (reason !== undefined) throw new MlsCommitRefusedError(reason);
            },
        ).then(() => {
            if (facts === undefined) throw new Error('MLS commit facts were not produced');
            return facts;
        });
    }

    forget(conversationId: ConversationId): Promise<void> {
        this.signatureKeys.delete(conversationId);
        return this.exclusive(conversationId, async () => {
            const session = this.sessions.get(conversationId);
            session?.companion?.fill(0);
            session?.chain?.fill(0);
            this.sessions.delete(conversationId);
            const response = await this.rpc({ kind: 'unload', conversationId });
            if (response.kind !== 'unloaded') throw new Error(`Unexpected MLS worker response ${response.kind}`);
        });
    }

    inspect(conversationId: ConversationId): Promise<MlsGroupInspection> {
        return this.exclusive(conversationId, async () => {
            this.requireUsableSession(conversationId);
            const response = await this.rpc({ kind: 'inspect', conversationId });
            if (response.kind !== 'inspected') throw new Error(`Unexpected MLS worker response ${response.kind}`);
            const memberNumbers =
                response.memberIdentities === undefined || response.memberIdentityLengths === undefined
                    ? undefined
                    : memberNumbersOf(response.memberIdentities, response.memberIdentityLengths);
            const signatureKeys =
                memberNumbers === undefined ||
                response.memberSignatureKeys === undefined ||
                response.memberSignatureKeyLengths === undefined
                    ? undefined
                    : pairSignatureKeys(
                          memberNumbers,
                          decodeIdentities(response.memberSignatureKeys, response.memberSignatureKeyLengths),
                      );
            if (signatureKeys !== undefined) this.signatureKeys.set(conversationId, signatureKeys);
            return {
                memberNumber: memberNumberOf(response.identity),
                epoch: response.epoch === undefined ? undefined : BigInt(response.epoch),
                memberNumbers,
                signatureKeys,
                epochAuthenticator:
                    response.epochAuthenticator === undefined
                        ? undefined
                        : Uint8Array.from(response.epochAuthenticator),
            };
        });
    }

    /** Signs authored bytes with this member's own MLS signature key. */
    sign(conversationId: ConversationId, message: Uint8Array): Promise<Uint8Array> {
        return this.exclusive(conversationId, async () => {
            this.requireUsableSession(conversationId);
            const response = await this.rpc({ kind: 'sign', conversationId, message });
            if (response.kind !== 'signed') throw new Error(`Unexpected MLS worker response ${response.kind}`);
            return Uint8Array.from(response.signature);
        });
    }

    /**
     * Answers whether the named member signed these bytes, against the signature key in that member's MLS leaf. A
     * member this group has never seen, or one whose key cannot be read, is not verified.
     */
    async verifyAuthor(
        conversationId: ConversationId,
        author: MemberNumber,
        message: Uint8Array,
        signature: Uint8Array,
    ): Promise<boolean> {
        let key = this.signatureKeys.get(conversationId)?.get(Number(author));
        if (key === undefined) {
            await this.inspect(conversationId);
            key = this.signatureKeys.get(conversationId)?.get(Number(author));
        }
        if (key === undefined) return false;
        return await this.exclusive(conversationId, async () => {
            this.requireUsableSession(conversationId);
            const response = await this.rpc({
                kind: 'verify',
                conversationId,
                signaturePublicKey: key,
                message,
                signature,
            });
            if (response.kind !== 'verified') throw new Error(`Unexpected MLS worker response ${response.kind}`);
            return response.valid;
        });
    }

    getCheckpointCompanion(conversationId: ConversationId): Uint8Array | undefined {
        const companion = this.requireUsableSession(conversationId).companion;
        return companion === undefined ? undefined : Uint8Array.from(companion);
    }

    getCheckpointChain(conversationId: ConversationId): Uint8Array | undefined {
        const chain = this.requireUsableSession(conversationId).chain;
        return chain === undefined ? undefined : Uint8Array.from(chain);
    }

    close(): void {
        this.failFatally(new Error('MLS worker client closed'));
        this.worker.terminate();
        for (const session of this.sessions.values()) {
            session.companion?.fill(0);
            session.chain?.fill(0);
        }
        this.sessions.clear();
        this.queues.clear();
    }

    private mutate<ResultKind extends MlsWorkerCommandResult['kind']>(
        conversationId: ConversationId,
        command: MlsWorkerCommand,
        expectedKind: ResultKind,
        checkpointCompanion?: (result: Extract<MlsWorkerCommandResult, { kind: ResultKind }>) => Uint8Array | undefined,
        checkpointChain?: Uint8Array,
        veto?: (result: Extract<MlsWorkerCommandResult, { kind: ResultKind }>) => void,
    ): Promise<Extract<MlsWorkerCommandResult, { kind: ResultKind }>> {
        return this.exclusive(conversationId, async () => {
            const session = this.requireUsableSession(conversationId);
            if (rotatesSignatureKeys(command.kind)) this.signatureKeys.delete(conversationId);
            const response = await this.rpc({ kind: 'execute', conversationId, command });
            if (response.kind !== 'executed') throw new Error(`Unexpected MLS worker response ${response.kind}`);
            if (response.result.kind !== expectedKind) {
                response.checkpoint.fill(0);
                try {
                    await this.rpc({
                        kind: 'rollback',
                        conversationId,
                        operationId: response.operationId,
                    });
                } catch (rollbackError) {
                    session.unusable = true;
                    throw new Error('Unexpected MLS result and worker rollback failed; reload required', {
                        cause: rollbackError,
                    });
                }
                throw new Error(`Unexpected MLS command result ${response.result.kind}`);
            }

            let nextCompanion: Uint8Array | undefined;
            try {
                const result = response.result as Extract<MlsWorkerCommandResult, { kind: ResultKind }>;
                veto?.(result);
                nextCompanion = checkpointCompanion === undefined ? session.companion : checkpointCompanion(result);
            } catch (companionError) {
                response.checkpoint.fill(0);
                try {
                    await this.rpc({
                        kind: 'rollback',
                        conversationId,
                        operationId: response.operationId,
                    });
                } catch (rollbackError) {
                    session.unusable = true;
                    throw new Error('MLS companion creation and worker rollback both failed; reload required', {
                        cause: { companionError, rollbackError },
                    });
                }
                throw companionError;
            }
            const nextChain = checkpointChain ?? session.chain;
            let revision: number;
            try {
                revision = await this.checkpointStore.save(
                    conversationId,
                    session.revision,
                    response.checkpoint,
                    nextCompanion,
                    nextChain,
                );
            } catch (storageError) {
                try {
                    await this.rpc({ kind: 'rollback', conversationId, operationId: response.operationId });
                } catch (rollbackError) {
                    session.unusable = true;
                    throw new Error('MLS checkpoint write and worker rollback both failed; reload required', {
                        cause: { storageError, rollbackError },
                    });
                }
                throw storageError;
            } finally {
                response.checkpoint.fill(0);
            }

            session.revision = revision;
            if (checkpointCompanion !== undefined) {
                session.companion?.fill(0);
                session.companion = nextCompanion === undefined ? undefined : Uint8Array.from(nextCompanion);
            }
            if (checkpointChain !== undefined) {
                session.chain?.fill(0);
                session.chain = Uint8Array.from(checkpointChain);
            }
            try {
                const accepted = await this.rpc({
                    kind: 'accept',
                    conversationId,
                    operationId: response.operationId,
                });
                if (accepted.kind !== 'accepted') throw new Error(`Unexpected MLS worker response ${accepted.kind}`);
            } catch (error) {
                session.unusable = true;
                throw new Error('MLS checkpoint was persisted but the worker did not acknowledge it; reload required', {
                    cause: error,
                });
            }
            return response.result as Extract<MlsWorkerCommandResult, { kind: ResultKind }>;
        });
    }

    private requireUsableSession(conversationId: ConversationId): Session {
        const session = this.sessions.get(conversationId);
        if (session === undefined) throw new Error(`MLS conversation ${conversationId} is not initialized`);
        if (session.unusable)
            throw new Error(`MLS conversation ${conversationId} must be reloaded from its checkpoint`);
        return session;
    }

    private exclusive<Result>(conversationId: ConversationId, operation: () => Promise<Result>): Promise<Result> {
        const previous = this.queues.get(conversationId) ?? Promise.resolve();
        const current = previous.catch(() => undefined).then(operation);
        this.queues.set(conversationId, current);
        return current.finally(() => {
            if (this.queues.get(conversationId) === current) this.queues.delete(conversationId);
        });
    }

    private rpc(request: MlsWorkerRequestPayload): Promise<MlsWorkerSuccessResponse> {
        if (this.fatalError !== undefined) return Promise.reject(this.fatalError);
        const requestId = this.nextRequestId++;
        return new Promise((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
            this.worker.postMessage({ protocolVersion: MLS_WORKER_PROTOCOL_VERSION, requestId, ...request });
        });
    }

    private failFatally(error: Error): void {
        this.fatalError ??= error;
        for (const session of this.sessions.values()) {
            session.unusable = true;
            session.companion?.fill(0);
            session.companion = undefined;
            session.chain?.fill(0);
            session.chain = undefined;
        }
        for (const pending of this.pending.values()) pending.reject(this.fatalError);
        this.pending.clear();
    }
}
