import { ConversationId, MemberNumber, toMemberNumber } from '../types/conversation';
import { MlsCheckpointStore } from './mlsCheckpointStore';
import {
    DEFAULT_MLS_WASM_ASSET_URLS,
    MLS_WORKER_PROTOCOL_VERSION,
    MlsWasmAssetUrls,
    MlsWorkerCommand,
    MlsWorkerCommandResult,
    MlsWorkerRequest,
    MlsWorkerRequestPayload,
    MlsWorkerResponse,
    MlsWorkerSuccessResponse,
} from './protocol';

export type MlsGroupInspection = {
    memberNumber: MemberNumber;
    epoch?: bigint;
    memberNumbers?: ReadonlyArray<MemberNumber>;
    epochAuthenticator?: Uint8Array;
};

export type MlsCommitOutcome = {
    senderMemberNumber: MemberNumber;
    epoch: bigint;
    added: ReadonlyArray<MemberNumber>;
    removed: ReadonlyArray<MemberNumber>;
};

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
            else pending.reject(new Error(response.error));
        };
        worker.onerror = () => this.failFatally(new Error('MLS worker crashed'));
        worker.onmessageerror = () => this.failFatally(new Error('MLS worker returned an unreadable response'));
    }

    initialize(conversationId: ConversationId, memberNumber: MemberNumber): Promise<void> {
        return this.exclusive(conversationId, async () => {
            const existing = this.sessions.get(conversationId);
            if (existing !== undefined) existing.unusable = true;
            const stored = await this.checkpointStore.load(conversationId);
            const companion = stored?.companion === undefined ? undefined : Uint8Array.from(stored.companion);
            const chain = stored?.chain === undefined ? undefined : Uint8Array.from(stored.chain);
            let adoptedCompanion = false;
            try {
                const response = await this.rpc({
                    kind: 'load',
                    conversationId,
                    memberNumber,
                    checkpoint: stored?.bytes,
                    assets: this.assets,
                });
                if (response.kind !== 'loaded') throw new Error(`Unexpected MLS worker response ${response.kind}`);
                if (response.memberNumber !== memberNumber)
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
    ): Promise<{ commit: Uint8Array; welcome: Uint8Array }> {
        return this.mutate(
            conversationId,
            { kind: 'stageAddMember', keyPackage },
            'memberAddStaged',
            checkpointCompanion === undefined
                ? undefined
                : ({ commit, welcome }) => checkpointCompanion({ commit, welcome }),
        ).then(({ commit, welcome }) => ({ commit, welcome }));
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
    ): Promise<{ senderMemberNumber: MemberNumber; payload: Uint8Array }> {
        return this.mutate(
            conversationId,
            { kind: 'processApplicationMessage', message },
            'applicationMessageProcessed',
        ).then((result) => ({
            senderMemberNumber: toMemberNumber(result.senderMemberNumber),
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

    processIncomingCommit(
        conversationId: ConversationId,
        message: Uint8Array,
        authorizedCommitters: ReadonlyArray<MemberNumber>,
    ): Promise<MlsCommitOutcome> {
        return this.mutate(
            conversationId,
            { kind: 'processIncomingCommit', message, authorizedCommitters },
            'commitProcessed',
        ).then((result) => ({
            senderMemberNumber: toMemberNumber(result.senderMemberNumber),
            epoch: BigInt(result.epoch),
            added: Array.from(result.added, toMemberNumber),
            removed: Array.from(result.removed, toMemberNumber),
        }));
    }

    inspect(conversationId: ConversationId): Promise<MlsGroupInspection> {
        return this.exclusive(conversationId, async () => {
            this.requireUsableSession(conversationId);
            const response = await this.rpc({ kind: 'inspect', conversationId });
            if (response.kind !== 'inspected') throw new Error(`Unexpected MLS worker response ${response.kind}`);
            return {
                memberNumber: toMemberNumber(response.memberNumber),
                epoch: response.epoch === undefined ? undefined : BigInt(response.epoch),
                memberNumbers:
                    response.memberNumbers === undefined
                        ? undefined
                        : Array.from(response.memberNumbers, toMemberNumber),
                epochAuthenticator:
                    response.epochAuthenticator === undefined
                        ? undefined
                        : Uint8Array.from(response.epochAuthenticator),
            };
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
    ): Promise<Extract<MlsWorkerCommandResult, { kind: ResultKind }>> {
        return this.exclusive(conversationId, async () => {
            const session = this.requireUsableSession(conversationId);
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
                nextCompanion =
                    checkpointCompanion === undefined
                        ? session.companion
                        : checkpointCompanion(response.result as Extract<MlsWorkerCommandResult, { kind: ResultKind }>);
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
