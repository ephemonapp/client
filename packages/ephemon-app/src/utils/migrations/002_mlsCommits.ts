import { Migration } from '../migrator';
import { STORE_MLS_COMMITS } from '../stores';

export const m002_mlsCommits: Migration = {
    id: '002_mls_commits',

    schema(db) {
        if (!db.objectStoreNames.contains(STORE_MLS_COMMITS)) {
            db.createObjectStore(STORE_MLS_COMMITS, { keyPath: ['c', 'n'] });
        }
    },
};
