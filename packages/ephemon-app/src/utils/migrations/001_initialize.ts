import { Migration } from '../migrator';
import { STORE_CONNECTIONS, STORE_KEYS, STORE_MESSAGES, STORE_META, STORE_MLS_CHECKPOINTS } from '../stores';

/** Creates the current vault; there is no data step. */
export const m001_initialize: Migration = {
    id: '001_initialize',

    schema(db) {
        for (const name of [STORE_META, STORE_KEYS, STORE_CONNECTIONS, STORE_MLS_CHECKPOINTS]) {
            if (!db.objectStoreNames.contains(name)) {
                db.createObjectStore(name, { keyPath: 'id' });
            }
        }
        if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
            db.createObjectStore(STORE_MESSAGES, { keyPath: ['c', 'n'] });
        }
    },
};
