import { getVault } from '../lib/vault';
import { ConversationId } from '../types/conversation';
import { Database } from '../utils/database';

export type LoadedMlsCheckpoint = {
    revision: number;
    bytes: Uint8Array;
    companion?: Uint8Array;
    chain?: Uint8Array;
};

export interface MlsCheckpointStore {
    load(conversationId: ConversationId): Promise<LoadedMlsCheckpoint | null>;
    save(
        conversationId: ConversationId,
        expectedRevision: number | null,
        bytes: Uint8Array,
        companion?: Uint8Array,
        chain?: Uint8Array,
    ): Promise<number>;
    delete(conversationId: ConversationId): Promise<void>;
}

export function createVaultMlsCheckpointStore(database: Database = getVault()): MlsCheckpointStore {
    return {
        async load(conversationId) {
            const stored = await database.getMlsCheckpoint(conversationId);
            return stored === null
                ? null
                : {
                      revision: stored.revision,
                      bytes: stored.checkpoint,
                      companion: stored.companion,
                      chain: stored.chain,
                  };
        },
        save(conversationId, expectedRevision, bytes, companion, chain) {
            return database.putMlsCheckpoint(conversationId, expectedRevision, bytes, companion, chain);
        },
        delete(conversationId) {
            return database.deleteMlsCheckpoint(conversationId);
        },
    };
}
