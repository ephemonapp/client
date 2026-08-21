import {
    DEFAULT_MLS_WASM_ASSET_URLS,
    MLS_WASM_ABI_VERSION,
    MLS_WORKER_PROTOCOL_VERSION,
    MlsWasmAssetUrls,
    MlsWorkerCommand,
    MlsWorkerCommandResult,
    MlsWorkerRequest,
    MlsWorkerResponse,
    MlsWorkerSuccessPayload,
} from './protocol';
import { WasmBindgen, WasmMlsClient } from './wasmBindings';

type WorkerScope = {
    importScripts(...urls: Array<string>): void;
    onmessage: ((event: MessageEvent<MlsWorkerRequest>) => void) | null;
    postMessage(message: MlsWorkerResponse): void;
};

declare const wasm_bindgen: WasmBindgen | undefined;

type PendingOperation = {
    id: number;
    before: Uint8Array;
};

type Session = {
    client: WasmMlsClient;
    pending?: PendingOperation;
};

const scope = self as unknown as WorkerScope;
const sessions = new Map<number, Session>();
let nextOperationId = 1;
let bindingsPromise: Promise<WasmBindgen> | undefined;
let loadedAssets: MlsWasmAssetUrls | undefined;

function copy(bytes: Uint8Array): Uint8Array {
    return Uint8Array.from(bytes);
}

function sameAssets(left: MlsWasmAssetUrls, right: MlsWasmAssetUrls): boolean {
    return left.glue === right.glue && left.wasm === right.wasm;
}

async function loadBindings(assets: MlsWasmAssetUrls): Promise<WasmBindgen> {
    if (loadedAssets !== undefined && !sameAssets(loadedAssets, assets)) {
        throw new Error('MLS WASM worker cannot switch asset URLs after initialization');
    }
    if (bindingsPromise !== undefined) return bindingsPromise;
    loadedAssets = assets;
    bindingsPromise = (async () => {
        scope.importScripts(assets.glue);
        const bindings = typeof wasm_bindgen === 'undefined' ? undefined : wasm_bindgen;
        if (bindings === undefined) throw new Error('MLS WASM glue did not expose wasm_bindgen');
        const exports = await bindings({ module_or_path: assets.wasm });
        const abi = exports.ephemon_mls_abi_version();
        if (abi !== MLS_WASM_ABI_VERSION) {
            throw new Error(`Unsupported MLS WASM ABI ${abi}; expected ${MLS_WASM_ABI_VERSION}`);
        }
        return bindings;
    })();
    return bindingsPromise;
}

function requireSession(conversationId: number): Session {
    const session = sessions.get(conversationId);
    if (session === undefined) throw new Error(`MLS conversation ${conversationId} is not loaded`);
    return session;
}

function ensureNoPending(session: Session): void {
    if (session.pending !== undefined) {
        throw new Error(`MLS operation ${session.pending.id} is awaiting checkpoint persistence`);
    }
}

function execute(client: WasmMlsClient, command: MlsWorkerCommand): MlsWorkerCommandResult {
    switch (command.kind) {
        case 'createGroup':
            client.createGroup(command.groupId);
            return { kind: 'groupCreated' };
        case 'createKeyPackage':
            return { kind: 'keyPackageCreated', keyPackage: copy(client.createKeyPackage()) };
        case 'stageAddMember': {
            const output = client.stageAddMember(command.keyPackage);
            try {
                return { kind: 'memberAddStaged', commit: copy(output.commit), welcome: copy(output.welcome) };
            } finally {
                output.free();
            }
        }
        case 'mergePendingCommit': {
            client.mergePendingCommit();
            return { kind: 'pendingCommitMerged', epoch: client.epoch().toString() };
        }
        case 'joinFromWelcome': {
            client.joinFromWelcome(command.welcome);
            return { kind: 'welcomeJoined', epoch: client.epoch().toString() };
        }
        case 'createApplicationMessage':
            return {
                kind: 'applicationMessageCreated',
                message: copy(client.createApplicationMessage(command.payload)),
            };
        case 'createSelfUpdate':
            return { kind: 'selfUpdateCreated', commit: copy(client.createSelfUpdate()) };
        case 'processIncomingCommit': {
            const outcome = client.processIncomingCommit(
                command.message,
                Uint32Array.from(command.authorizedCommitters),
            );
            try {
                return {
                    kind: 'commitProcessed',
                    senderMemberNumber: outcome.senderMemberNumber,
                    epoch: outcome.epoch.toString(),
                    added: Array.from(outcome.added),
                    removed: Array.from(outcome.removed),
                };
            } finally {
                outcome.free();
            }
        }
        case 'processApplicationMessage': {
            const output = client.processApplicationMessage(command.message);
            try {
                return {
                    kind: 'applicationMessageProcessed',
                    senderMemberNumber: output.senderMemberNumber,
                    payload: copy(output.payload),
                };
            } finally {
                output.free();
            }
        }
    }
}

function success(requestId: number, response: MlsWorkerSuccessPayload): void {
    scope.postMessage({
        protocolVersion: MLS_WORKER_PROTOCOL_VERSION,
        requestId,
        ok: true,
        ...response,
    } as MlsWorkerResponse);
}

function failure(requestId: number, error: unknown): void {
    scope.postMessage({
        protocolVersion: MLS_WORKER_PROTOCOL_VERSION,
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
    });
}

async function handle(request: MlsWorkerRequest): Promise<void> {
    if (request.protocolVersion !== MLS_WORKER_PROTOCOL_VERSION) {
        throw new Error(`Unsupported MLS worker protocol ${request.protocolVersion}`);
    }
    switch (request.kind) {
        case 'load': {
            const bindings = await loadBindings(request.assets ?? DEFAULT_MLS_WASM_ASSET_URLS);
            const existing = sessions.get(request.conversationId);
            if (existing?.pending !== undefined && request.checkpoint === undefined) {
                throw new Error(`MLS operation ${existing.pending.id} must be accepted or rolled back before reload`);
            }
            const client =
                request.checkpoint === undefined
                    ? new bindings.EphemonMlsClient(request.memberNumber)
                    : bindings.EphemonMlsClient.importCheckpoint(request.checkpoint);
            if (client.memberNumber !== request.memberNumber) {
                client.free();
                throw new Error('MLS checkpoint member number does not match the conversation roster');
            }
            existing?.client.free();
            existing?.pending?.before.fill(0);
            sessions.set(request.conversationId, { client });
            success(request.requestId, { kind: 'loaded', memberNumber: client.memberNumber });
            return;
        }
        case 'execute': {
            const bindings = await loadBindings(loadedAssets ?? DEFAULT_MLS_WASM_ASSET_URLS);
            const session = requireSession(request.conversationId);
            ensureNoPending(session);
            const before = copy(session.client.exportCheckpoint());
            let result: MlsWorkerCommandResult;
            try {
                result = execute(session.client, request.command);
            } catch (error) {
                const restored = bindings.EphemonMlsClient.importCheckpoint(before);
                session.client.free();
                session.client = restored;
                before.fill(0);
                throw error;
            }
            const operationId = nextOperationId++;
            session.pending = { id: operationId, before };
            success(request.requestId, {
                kind: 'executed',
                operationId,
                checkpoint: copy(session.client.exportCheckpoint()),
                result,
            });
            return;
        }
        case 'accept': {
            const session = requireSession(request.conversationId);
            if (session.pending?.id !== request.operationId) throw new Error('MLS operation acceptance does not match');
            session.pending.before.fill(0);
            session.pending = undefined;
            success(request.requestId, { kind: 'accepted', operationId: request.operationId });
            return;
        }
        case 'rollback': {
            const bindings = await loadBindings(loadedAssets ?? DEFAULT_MLS_WASM_ASSET_URLS);
            const session = requireSession(request.conversationId);
            if (session.pending?.id !== request.operationId) throw new Error('MLS operation rollback does not match');
            const before = session.pending.before;
            const restored = bindings.EphemonMlsClient.importCheckpoint(before);
            session.client.free();
            session.client = restored;
            before.fill(0);
            session.pending = undefined;
            success(request.requestId, { kind: 'rolledBack', operationId: request.operationId });
            return;
        }
        case 'inspect': {
            const session = requireSession(request.conversationId);
            ensureNoPending(session);
            let epoch: string | undefined;
            let memberNumbers: Uint32Array | undefined;
            let epochAuthenticator: Uint8Array | undefined;
            try {
                epoch = session.client.epoch().toString();
                memberNumbers = Uint32Array.from(session.client.memberNumbers());
                epochAuthenticator = copy(session.client.epochAuthenticator());
            } catch {}
            success(request.requestId, {
                kind: 'inspected',
                memberNumber: session.client.memberNumber,
                epoch,
                memberNumbers,
                epochAuthenticator,
            });
        }
    }
}

scope.onmessage = (event) => {
    const request = event.data;
    handle(request).catch((error) => failure(request.requestId, error));
};
