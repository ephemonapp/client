import { Bytes } from '../cryptography';
import { committed, readAll } from '../idb';
import { Migration, MigrationContext } from '../migrator';
import { STORE_CACHE, STORE_CONNECTIONS, STORE_MESSAGES } from '../stores';

type EncryptedRow = { id: string | number; iv: Bytes; data: ArrayBuffer };
type MessageRow = { c: string | number; n: number; iv: Bytes; data: ArrayBuffer };

const NUMERIC = /^\d+$/;

function isStale(key: string | number): key is string {
    return typeof key === 'string' && NUMERIC.test(key);
}

async function renumberEnvelopes(context: MigrationContext, storeName: string): Promise<number> {
    const stale = (await readAll<EncryptedRow>(context.db, storeName)).filter((row) => isStale(row.id));
    if (stale.length === 0) return 0;

    const prepared: Array<{ from: string; row: EncryptedRow }> = [];
    for (const row of stale) {
        const envelope = await context.cryptography.decrypt<{ id: string; value: unknown }>(context.dataKey, {
            iv: row.iv,
            data: row.data,
        });
        const id = Number(row.id);
        const { iv, data } = await context.cryptography.encrypt(context.dataKey, { id, value: envelope.value });
        prepared.push({ from: row.id as string, row: { id, iv, data } });
    }

    const transaction = context.db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    for (const item of prepared) {
        store.put(item.row);
        store.delete(item.from);
    }
    await committed(transaction);
    return prepared.length;
}

async function renumberMessages(context: MigrationContext): Promise<number> {
    const stale = (await readAll<MessageRow>(context.db, STORE_MESSAGES)).filter((row) => isStale(row.c));
    if (stale.length === 0) return 0;

    const transaction = context.db.transaction([STORE_MESSAGES], 'readwrite');
    const store = transaction.objectStore(STORE_MESSAGES);
    for (const row of stale) {
        store.put({ c: Number(row.c), n: row.n, iv: row.iv, data: row.data });
        store.delete([row.c as string, row.n]);
    }
    await committed(transaction);
    return stale.length;
}

export const m003_numericChatIds: Migration = {
    id: '003_numeric_chat_ids',

    async data(context) {
        let done = 0;
        for (const storeName of [STORE_CONNECTIONS, STORE_CACHE]) {
            done += await renumberEnvelopes(context, storeName);
            context.report(done, done);
        }
        done += await renumberMessages(context);
        context.report(done, done);
        context.logger.debug(`[migrations] Renumbered ${done} rows onto numeric chat ids.`);
    },
};
