export type WasmMlsAddMemberOutput = {
    readonly claimedIdentity: Uint8Array;
    readonly commit: Uint8Array;
    readonly welcome: Uint8Array;
    free(): void;
};

export type WasmMlsProcessedApplicationMessage = {
    readonly senderIdentity: Uint8Array;
    readonly senderIsMember: boolean;
    readonly payload: Uint8Array;
    free(): void;
};

export type WasmMlsCommitFacts = {
    readonly senderIdentity: Uint8Array;
    readonly senderIsMember: boolean;
    readonly added: Uint8Array;
    readonly addedLengths: Uint32Array;
    readonly removedLeaves: Uint32Array;
    readonly epoch: bigint;
    free(): void;
};

export type WasmMlsClient = {
    readonly identity: Uint8Array;
    createGroup(groupId: Uint8Array): void;
    createKeyPackage(): Uint8Array;
    stageAddMember(keyPackage: Uint8Array): WasmMlsAddMemberOutput;
    mergePendingCommit(): void;
    joinFromWelcome(welcome: Uint8Array): void;
    createApplicationMessage(payload: Uint8Array): Uint8Array;
    processApplicationMessage(message: Uint8Array): WasmMlsProcessedApplicationMessage;
    createSelfUpdate(): Uint8Array;
    processIncomingCommit(message: Uint8Array): WasmMlsCommitFacts;
    epochAuthenticator(): Uint8Array;
    storageSnapshot(): Uint8Array;
    readonly signingPublicKey: Uint8Array;
    readonly groupId: Uint8Array;
    epoch(): bigint;
    memberIdentities(): Uint8Array;
    memberIdentityLengths(): Uint32Array;
    memberSignatureKeys(): Uint8Array;
    memberSignatureKeyLengths(): Uint32Array;
    sign(message: Uint8Array): Uint8Array;
    verify(signaturePublicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean;
    free(): void;
};

export type WasmMlsClientConstructor = {
    new (identity: Uint8Array): WasmMlsClient;
    restore(
        identity: Uint8Array,
        signingPublicKey: Uint8Array,
        groupId: Uint8Array,
        keys: Uint8Array,
        keyLengths: Uint32Array,
        values: Uint8Array,
        valueLengths: Uint32Array,
    ): WasmMlsClient;
};

export type WasmBindgen = {
    (input: { module_or_path: string }): Promise<{ ephemon_mls_abi_version(): number }>;
    EphemonMlsClient: WasmMlsClientConstructor;
};
