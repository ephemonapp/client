import { ChatWindowMessageType } from '../../types/chatMessageType';
import { Bytes } from '../cryptography';
import { committed } from '../idb';
import { Migration, MigrationContext } from '../migrator';
import { STORE_CACHE, STORE_CONNECTIONS, STORE_KEYS, STORE_MESSAGES, STORE_META } from '../stores';
import {
    countLegacyRows,
    existingLegacyStores,
    LEGACY_TABLE_CACHE,
    LEGACY_TABLE_CONNECTIONS,
    LEGACY_TABLE_HISTORY,
    LEGACY_TABLE_KEYS,
    readLegacyTable,
} from './legacy';

const REKEYED_TABLES: Array<[string, string]> = [
    [LEGACY_TABLE_KEYS, STORE_KEYS],
    [LEGACY_TABLE_CONNECTIONS, STORE_CONNECTIONS],
    [LEGACY_TABLE_CACHE, STORE_CACHE],
];

const COUNTED_TABLES = [LEGACY_TABLE_KEYS, LEGACY_TABLE_CONNECTIONS, LEGACY_TABLE_CACHE, LEGACY_TABLE_HISTORY];

async function rekeyTable(context: MigrationContext, legacyTable: string, storeName: string): Promise<number> {
    const rows = await readLegacyTable<unknown>(context, legacyTable);
    if (rows.length === 0) return 0;

    const prepared: Array<{ id: string; iv: Bytes; data: ArrayBuffer }> = [];
    for (const row of rows) {
        const { iv, data } = await context.cryptography.encrypt(context.dataKey, { id: row.id, value: row.value });
        prepared.push({ id: row.id, iv, data });
    }

    const transaction = context.db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    for (const item of prepared) {
        store.put(item);
    }
    await committed(transaction);
    return prepared.length;
}

async function explodeChat(
    context: MigrationContext,
    chatId: string,
    messages: Array<ChatWindowMessageType>,
): Promise<void> {
    const prepared: Array<{ c: string; n: number; iv: Bytes; data: ArrayBuffer }> = [];
    for (let n = 0; n < messages.length; n++) {
        const { iv, data } = await context.cryptography.encrypt(context.dataKey, messages[n]);
        prepared.push({ c: chatId, n, iv, data });
    }

    const transaction = context.db.transaction([STORE_MESSAGES], 'readwrite');
    const store = transaction.objectStore(STORE_MESSAGES);
    for (const row of prepared) {
        store.put(row);
    }
    await committed(transaction);
}

async function clearLegacyTables(context: MigrationContext): Promise<void> {
    const names = await existingLegacyStores(context.db, context.cryptography);
    if (names.length === 0) return;
    const transaction = context.db.transaction(names, 'readwrite');
    for (const name of names) {
        transaction.objectStore(name).clear();
    }
    await committed(transaction);
}

export const m001_vaultV2: Migration = {
    id: '001_vault_v2',

    schema(db) {
        for (const name of [STORE_META, STORE_KEYS, STORE_CONNECTIONS, STORE_CACHE]) {
            if (!db.objectStoreNames.contains(name)) {
                db.createObjectStore(name, { keyPath: 'id' });
            }
        }
        if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
            db.createObjectStore(STORE_MESSAGES, { keyPath: ['c', 'n'] });
        }
    },

    async data(context) {
        const total = await countLegacyRows(context.db, context.cryptography, COUNTED_TABLES);
        if (total === 0) return;

        let done = 0;
        for (const [legacyTable, storeName] of REKEYED_TABLES) {
            done += await rekeyTable(context, legacyTable, storeName);
            context.report(done, total);
        }

        const chats = await readLegacyTable<Array<ChatWindowMessageType>>(context, LEGACY_TABLE_HISTORY);
        for (const chat of chats) {
            const messages = (chat.value ?? []).filter((message) => message.sender !== 'date');
            if (messages.length > 0) {
                await explodeChat(context, chat.id, messages);
            }
            done++;
            context.report(done, total);
        }

        await clearLegacyTables(context);
        context.logger.debug(`[migrations] Moved ${total} legacy rows into the v2 vault.`);
    },
};
