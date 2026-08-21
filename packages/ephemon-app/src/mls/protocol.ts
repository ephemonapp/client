export const MLS_WORKER_PROTOCOL_VERSION = 1;
export const MLS_WASM_ABI_VERSION = 3;

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
    | { kind: 'processIncomingCommit'; message: Uint8Array; authorizedCommitters: ReadonlyArray<number> };

export type MlsWorkerCommandResult =
    | { kind: 'groupCreated' }
    | { kind: 'keyPackageCreated'; keyPackage: Uint8Array }
    | { kind: 'memberAddStaged'; commit: Uint8Array; welcome: Uint8Array }
    | { kind: 'pendingCommitMerged'; epoch: string }
    | { kind: 'welcomeJoined'; epoch: string }
    | { kind: 'applicationMessageCreated'; message: Uint8Array }
    | { kind: 'applicationMessageProcessed'; senderMemberNumber: number; payload: Uint8Array }
    | { kind: 'selfUpdateCreated'; commit: Uint8Array }
    | {
          kind: 'commitProcessed';
          senderMemberNumber: number;
          epoch: string;
          added: ReadonlyArray<number>;
          removed: ReadonlyArray<number>;
      };

export type MlsWorkerRequest =
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          kind: 'load';
          conversationId: number;
          memberNumber: number;
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
          kind: 'inspect';
          conversationId: number;
      };

export type MlsWorkerResponse =
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          ok: true;
          kind: 'loaded';
          memberNumber: number;
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
          kind: 'inspected';
          memberNumber: number;
          epoch?: string;
          memberNumbers?: Uint32Array;
          epochAuthenticator?: Uint8Array;
      }
    | {
          protocolVersion: typeof MLS_WORKER_PROTOCOL_VERSION;
          requestId: number;
          ok: false;
          error: string;
      };

type DistributiveOmit<Union, Keys extends PropertyKey> = Union extends unknown ? Omit<Union, Keys> : never;

export type MlsWorkerRequestPayload = DistributiveOmit<MlsWorkerRequest, 'protocolVersion' | 'requestId'>;
export type MlsWorkerSuccessResponse = Extract<MlsWorkerResponse, { ok: true }>;
export type MlsWorkerSuccessPayload = DistributiveOmit<
    MlsWorkerSuccessResponse,
    'protocolVersion' | 'requestId' | 'ok'
>;
