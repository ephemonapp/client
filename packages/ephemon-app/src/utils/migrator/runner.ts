import { committed, readAll } from '../idb';
import { Logger } from '../logger';
import { STORE_MIGRATIONS } from '../stores';
import { Migration, MigrationContext } from './types';

export function ensureMigrationStore(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(STORE_MIGRATIONS)) {
        db.createObjectStore(STORE_MIGRATIONS, { keyPath: 'id' });
    }
}

export async function pendingMigrations(
    db: IDBDatabase,
    migrations: ReadonlyArray<Migration>,
): Promise<Array<Migration>> {
    const applied = new Set((await readAll<{ id: string }>(db, STORE_MIGRATIONS)).map((row) => row.id));
    return migrations.filter((migration) => !applied.has(migration.id));
}

function currentBatch(applied: Set<string>, migrations: ReadonlyArray<Migration>): Array<Migration> {
    const batch: Array<Migration> = [];
    for (const migration of migrations) {
        if (applied.has(migration.id)) continue;
        batch.push(migration);
        if (migration.data !== undefined) break;
    }
    return batch;
}

export function runSchemaPhase(
    db: IDBDatabase,
    transaction: IDBTransaction,
    migrations: ReadonlyArray<Migration>,
    logger: Logger,
): void {
    const store = transaction.objectStore(STORE_MIGRATIONS);
    const request = store.getAllKeys();
    request.onsuccess = () => {
        const applied = new Set(request.result as Array<string>);
        for (const migration of currentBatch(applied, migrations)) {
            if (migration.schema === undefined) continue;
            migration.schema(db);
            logger.debug(`[migrations] Applied schema phase of ${migration.id}.`);
        }
    };
}

export async function runDataPhase(context: MigrationContext, migrations: ReadonlyArray<Migration>): Promise<void> {
    const applied = new Set((await readAll<{ id: string }>(context.db, STORE_MIGRATIONS)).map((row) => row.id));
    for (const migration of currentBatch(applied, migrations)) {
        await migration.data?.(context);
        const transaction = context.db.transaction([STORE_MIGRATIONS], 'readwrite');
        transaction.objectStore(STORE_MIGRATIONS).put({ id: migration.id });
        await committed(transaction);
        context.logger.debug(`[migrations] Applied ${migration.id}.`);
    }
}
