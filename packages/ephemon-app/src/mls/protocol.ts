export const MLS_WORKER_PROTOCOL_VERSION = 1;
/** Must match `ABI_VERSION` in packages/ephemon-mls/src/lib.rs; the wasm harness fails when they diverge. */
export const MLS_WASM_ABI_VERSION = 5;

export type MlsWasmAssetUrls = {
    glue: string;
    wasm: string;
};

export const DEFAULT_MLS_WASM_ASSET_URLS: MlsWasmAssetUrls = {
    glue: '/mls.min.js',
    wasm: '/mls.wasm',
};

export type MlsWorkerCommand =
    | { kind: 'createGroup'; groupId: Uint8Array }
    | { kind: 'createKeyPackage' }
    | { kind: 'stageAddMember'; keyPackage: Uint8Array }
    | { kind: 'mergePendingCommit' }
    | { kind: 'joinFromWelcome'; welcome: Uint8Array }
    | { kind: 'createApplicationMessage'; payload: Uint8Array }
    | { kind: 'processApplicationMessage'; message: Uint8Array }
    | { kind: 'createSelfUpdate' }
    | { kind: 'processIncomingCommit'; message: Uint8Array };

export type MlsWorkerCommandResult =
    | { kind: 'groupCreated' }
    | { kind: 'keyPackageCreated'; keyPackage: Uint8Array }
    | { kind: 'memberAddStaged'; claimedIdentity: Uint8Array; commit: Uint8Array; welcome: Uint8Array }
    | { kind: 'pendingCommitMerged'; epoch: string }
    | { kind: 'welcomeJoined'; epoch: string }
    | { kind: 'applicationMessageCreated'; message: Uint8Array }
    | {
          kind: 'applicationMessageProcessed';
          senderIdentity: Uint8Array;
          senderIsMember: boolean;
          payload: Uint8Array;
      }
    | { kind: 'selfUpdateCreated'; commit: Uint8Array }
    | {
          kind: 'commitProcessed';
          senderIdentity: Uint8Array;
          senderIsMember: boolean;
          added: Uint8Array;
          addedLengths: Uint32Array;
          removedLeaves: ReadonlyArray<number>;
          epoch: string;
      };

export type MlsWorkerRequest =
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          kind: 'load';
          conversationId: number;
          identity: Uint8Array;
          checkpoint?: Uint8Array;
          assets?: MlsWasmAssetUrls;
      }
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          kind: 'execute';
          conversationId: number;
          command: MlsWorkerCommand;
      }
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          kind: 'accept' | 'rollback';
          conversationId: number;
          operationId: number;
      }
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          kind: 'sign';
          conversationId: number;
          message: Uint8Array;
      }
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          kind: 'verify';
          conversationId: number;
          signaturePublicKey: Uint8Array;
          message: Uint8Array;
          signature: Uint8Array;
      }
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          kind: 'inspect';
          conversationId: number;
      }
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          kind: 'unload';
          conversationId: number;
      };

export type MlsWorkerResponse =
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          ok: true;
          kind: 'loaded';
          identity: Uint8Array;
      }
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          ok: true;
          kind: 'unloaded';
      }
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          ok: true;
          kind: 'executed';
          operationId: number;
          checkpoint: Uint8Array;
          result: MlsWorkerCommandResult;
      }
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          ok: true;
          kind: 'accepted' | 'rolledBack';
          operationId: number;
      }
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          ok: true;
          kind: 'signed';
          signature: Uint8Array;
      }
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          ok: true;
          kind: 'verified';
          valid: boolean;
      }
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          ok: true;
          kind: 'inspected';
          identity: Uint8Array;
          epoch?: string;
          memberIdentities?: Uint8Array;
          memberIdentityLengths?: Uint32Array;
          memberSignatureKeys?: Uint8Array;
          memberSignatureKeyLengths?: Uint32Array;
          epochAuthenticator?: Uint8Array;
      }
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          ok: false;
          error: string;
          code: MlsWorkerErrorCode;
      };

/** How a worker failure is classified for callers; 'unknown' carries no promise about what went wrong. */
export type MlsWorkerErrorCode = 'wrongEpoch' | 'unableToDecrypt' | 'unknown';

export function classifyMlsError(message: string): MlsWorkerErrorCode {
    if (message.includes('WrongEpoch')) return 'wrongEpoch';
    if (message.includes('UnableToDecrypt')) return 'unableToDecrypt';
    return 'unknown';
}

type DistributiveOmit<Union, Keys extends PropertyKey> = Union extends unknown ? Omit<Union, Keys> : never;

export type MlsWorkerRequestPayload = DistributiveOmit<MlsWorkerRequest, 'protocolVersion' | 'requestId'>;
export type MlsWorkerSuccessResponse = Extract<MlsWorkerResponse, { ok: true }>;
export type MlsWorkerSuccessPayload = DistributiveOmit<
    MlsWorkerSuccessResponse,
    'protocolVersion' | 'requestId' | 'ok'
>;
