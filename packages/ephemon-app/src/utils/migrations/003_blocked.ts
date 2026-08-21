import { Migration } from '../migrator';
import { STORE_BLOCKED } from '../stores';

export const m003_blocked: Migration = {
    id: '003_blocked',

    schema(db) {
        if (!db.objectStoreNames.contains(STORE_BLOCKED)) {
            db.createObjectStore(STORE_BLOCKED, { keyPath: 'id' });
        }
    },
};
