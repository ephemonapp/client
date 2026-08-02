import { Migration } from '../migrator';
import { REQUIRED_STORES } from '../stores';

export const m002_dropLegacyStores: Migration = {
    id: '002_drop_legacy_stores',

    schema(db) {
        const names = db.objectStoreNames;
        for (let index = names.length - 1; index >= 0; index--) {
            const name = names.item(index);
            if (name === null || REQUIRED_STORES.includes(name)) continue;
            db.deleteObjectStore(name);
        }
    },
};
