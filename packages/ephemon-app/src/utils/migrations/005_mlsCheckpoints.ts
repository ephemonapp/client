import { Migration } from '../migrator';
import { STORE_MLS_CHECKPOINTS } from '../stores';

export const m005_mlsCheckpoints: Migration = {
    id: '005_mls_checkpoints',

    schema(db) {
        if (!db.objectStoreNames.contains(STORE_MLS_CHECKPOINTS)) {
            db.createObjectStore(STORE_MLS_CHECKPOINTS, { keyPath: 'id' });
        }
    },
};
