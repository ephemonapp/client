import { Migration } from '../migrator';
import { STORE_CACHE } from '../stores';

export const m004_dropCacheStore: Migration = {
    id: '004_drop_cache_store',

    schema(db) {
        if (db.objectStoreNames.contains(STORE_CACHE)) {
            db.deleteObjectStore(STORE_CACHE);
        }
    },
};
