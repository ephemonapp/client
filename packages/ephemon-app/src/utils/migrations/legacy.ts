import { Cryptography } from '../cryptography';
import { readAll, toPromise } from '../idb';
import { MigrationContext } from '../migrator';

export const LEGACY_TABLE_CHECK = 'check';
export const LEGACY_TABLE_KEYS = 'keys';
export const LEGACY_TABLE_CONNECTIONS = 'connections';
export const LEGACY_TABLE_HISTORY = 'history';
export const LEGACY_TABLE_CACHE = 'cache';

export const LEGACY_TABLES = [
    LEGACY_TABLE_CHECK,
    LEGACY_TABLE_KEYS,
    LEGACY_TABLE_CONNECTIONS,
    LEGACY_TABLE_HISTORY,
    LEGACY_TABLE_CACHE,
];

const PASSWORD_ORACLES = [LEGACY_TABLE_CHECK, LEGACY_TABLE_KEYS, LEGACY_TABLE_CONNECTIONS];

export type LegacyRow = {
    id: string;
    iv: number[];
    salt: number[];
    encryptedData: number[];
};

async function decryptRow<TypeData>(
    cryptography: Cryptography,
    password: string,
    row: LegacyRow,
): Promise<{ id: string; value: TypeData }> {
    const key = await cryptography.legacyDeriveKey(password, Uint8Array.from(row.salt));
    return await cryptography.legacyDecrypt<{ id: string; value: TypeData }>(
        key,
        Uint8Array.from(row.iv),
        Uint8Array.from(row.encryptedData),
    );
}

export async function countLegacyRows(
    db: IDBDatabase,
    cryptography: Cryptography,
    tables: ReadonlyArray<string>,
): Promise<number> {
    let total = 0;
    for (const table of tables) {
        const name = await cryptography.legacyHashString(table);
        if (!db.objectStoreNames.contains(name)) continue;
        const transaction = db.transaction([name], 'readonly');
        total += await toPromise(transaction.objectStore(name).count());
    }
    return total;
}

export async function readLegacyTable<TypeData>(
    context: MigrationContext,
    table: string,
): Promise<Array<{ id: string; value: TypeData }>> {
    const storeName = await context.cryptography.legacyHashString(table);
    const rows = await readAll<LegacyRow>(context.db, storeName);
    const decoded: Array<{ id: string; value: TypeData }> = [];
    for (const row of rows) {
        decoded.push(await decryptRow<TypeData>(context.cryptography, context.password, row));
    }
    return decoded;
}

export async function existingLegacyStores(db: IDBDatabase, cryptography: Cryptography): Promise<Array<string>> {
    const names: Array<string> = [];
    for (const table of LEGACY_TABLES) {
        const name = await cryptography.legacyHashString(table);
        if (db.objectStoreNames.contains(name)) names.push(name);
    }
    return names;
}

export async function hasLegacyVault(db: IDBDatabase, cryptography: Cryptography): Promise<boolean> {
    for (const table of PASSWORD_ORACLES) {
        const name = await cryptography.legacyHashString(table);
        if (!db.objectStoreNames.contains(name)) continue;
        const transaction = db.transaction([name], 'readonly');
        if ((await toPromise(transaction.objectStore(name).count())) > 0) return true;
    }
    return false;
}

export async function verifyLegacyPassword(
    db: IDBDatabase,
    cryptography: Cryptography,
    password: string,
): Promise<boolean> {
    for (const table of PASSWORD_ORACLES) {
        const name = await cryptography.legacyHashString(table);
        const rows = await readAll<LegacyRow>(db, name);
        if (rows.length === 0) continue;
        try {
            await decryptRow(cryptography, password, rows[0]);
            return true;
        } catch {
            return false;
        }
    }
    return false;
}
