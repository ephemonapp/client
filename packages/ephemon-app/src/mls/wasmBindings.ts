export type WasmMlsAddMemberOutput = {
    readonly commit: Uint8Array;
    readonly welcome: Uint8Array;
    free(): void;
};

export type WasmMlsProcessedApplicationMessage = {
    readonly senderMemberNumber: number;
    readonly payload: Uint8Array;
    free(): void;
};

export type WasmMlsClient = {
    readonly memberNumber: number;
    createGroup(groupId: Uint8Array): void;
    createKeyPackage(): Uint8Array;
    stageAddMember(keyPackage: Uint8Array): WasmMlsAddMemberOutput;
    mergePendingCommit(): void;
    joinFromWelcome(welcome: Uint8Array): void;
    createApplicationMessage(payload: Uint8Array): Uint8Array;
    processApplicationMessage(message: Uint8Array): WasmMlsProcessedApplicationMessage;
    exportCheckpoint(): Uint8Array;
    epoch(): bigint;
    memberNumbers(): Uint32Array;
    free(): void;
};

export type WasmMlsClientConstructor = {
    new (memberNumber: number): WasmMlsClient;
    importCheckpoint(checkpoint: Uint8Array): WasmMlsClient;
};

export type WasmBindgen = {
    (input: { module_or_path: string }): Promise<{ ephemon_mls_abi_version(): number }>;
    EphemonMlsClient: WasmMlsClientConstructor;
};
