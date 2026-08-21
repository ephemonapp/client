import { getCryptography } from '../utils/cryptography';
import getDatabase, { MlsCheckpointConflictError } from '../utils/database';
import { toPromise } from '../utils/idb';
import { Logger } from '../utils/logger';
import { STORE_MLS_CHECKPOINTS } from '../utils/stores';

const logger: Logger = {
    trace() {},
    debug() {},
    log() {},
    warn() {},
    error() {},
};

async function deleteDatabase(name: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`Test database '${name}' is blocked`));
    });
}

async function inspectRawRow(name: string, conversationId: number): Promise<{ rawBytes: number }> {
    const database = await toPromise(indexedDB.open(name));
    try {
        const transaction = database.transaction([STORE_MLS_CHECKPOINTS], 'readonly');
        const row = await toPromise<Record<string, unknown>>(
            transaction.objectStore(STORE_MLS_CHECKPOINTS).get(conversationId),
        );
        if ('checkpoint' in row) throw new Error('MLS checkpoint was stored as plaintext');
        if (!(row.data instanceof ArrayBuffer)) throw new Error('MLS checkpoint row is not encrypted');
        return { rawBytes: row.data.byteLength };
    } finally {
        database.close();
    }
}

async function runMlsStorageTest(): Promise<{
    firstRevision: number;
    secondRevision: number;
    rawBytes: number;
}> {
    const databaseName = `ephemon-mls-storage-test-${crypto.randomUUID()}`;
    const conversationId = 41;
    const database = getDatabase(logger, getCryptography());
    database.initialize({ dbName: databaseName });
    try {
        if ((await database.unlock('test-only-password')) !== 'valid') throw new Error('Could not unlock test vault');
        const firstRevision = await database.putMlsCheckpoint(
            conversationId,
            null,
            Uint8Array.from([0, 1, 2, 255]),
            Uint8Array.from([7, 8, 9]),
        );
        const first = await database.getMlsCheckpoint(conversationId);
        if (
            first?.revision !== firstRevision ||
            Array.from(first.checkpoint).join(',') !== '0,1,2,255' ||
            Array.from(first.companion ?? []).join(',') !== '7,8,9'
        ) {
            throw new Error('Encrypted MLS checkpoint did not round-trip');
        }

        let conflict = false;
        try {
            await database.putMlsCheckpoint(conversationId, null, Uint8Array.from([9]));
        } catch (error) {
            conflict = error instanceof MlsCheckpointConflictError;
        }
        if (!conflict) throw new Error('Stale MLS checkpoint writer was not rejected');

        const secondRevision = await database.putMlsCheckpoint(
            conversationId,
            firstRevision,
            Uint8Array.from([5, 6, 7]),
        );
        database.close();
        const { rawBytes } = await inspectRawRow(databaseName, conversationId);
        return { firstRevision, secondRevision, rawBytes };
    } finally {
        database.close();
        await deleteDatabase(databaseName);
    }
}

declare global {
    interface Window {
        runMlsStorageTest(): ReturnType<typeof runMlsStorageTest>;
    }
}

window.runMlsStorageTest = runMlsStorageTest;
