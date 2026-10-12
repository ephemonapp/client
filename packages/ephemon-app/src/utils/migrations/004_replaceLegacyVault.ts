import { committed, readAll } from '../idb';
import { Migration } from '../migrator';
import { STORE_MESSAGES, STORE_MIGRATIONS } from '../stores';

const LEGACY_STORE_CACHE = 'cache';

const LEGACY_MIGRATION_IDS = ['001_vault_v2', '002_drop_legacy_stores', '003_numeric_chat_ids', '004_drop_cache_store'];

/**
 * D-010: a vault written before MLS is replaced rather than converted. Its message rows hold pre-MLS values that
 * deserialize into neither an event nor a receipt, so they would sit in the store unreadable and unreachable forever.
 */
export const m004_replaceLegacyVault: Migration = {
    id: '004_replace_legacy_vault',

    schema(db) {
        if (db.objectStoreNames.contains(LEGACY_STORE_CACHE)) db.deleteObjectStore(LEGACY_STORE_CACHE);
    },

    async data({ db, logger }) {
        const applied = (await readAll<{ id: string }>(db, STORE_MIGRATIONS)).map((row) => row.id);
        if (!applied.some((id) => LEGACY_MIGRATION_IDS.includes(id))) return;
        logger.warn('[migrations] Replacing a pre-MLS vault: its message history cannot be read as MLS events.');
        const transaction = db.transaction([STORE_MESSAGES], 'readwrite');
        transaction.objectStore(STORE_MESSAGES).clear();
        await committed(transaction);
    },
};
