import { getCryptography } from '../utils/cryptography';
import getDatabase from '../utils/database';
import { getLogger } from './logStore';

export const DB_SLUG = 'ephemon';

export { STORE_CONNECTIONS as DB_SLUG_TABLE_CONNECTIONS, STORE_KEYS as DB_SLUG_TABLE_KEYS } from '../utils/stores';

type Vault = ReturnType<typeof getDatabase>;

let vault: Vault | undefined;

export function getVault(): Vault {
    if (vault === undefined) {
        vault = getDatabase(getLogger(), getCryptography());
        vault.initialize({ dbName: DB_SLUG });
    }
    return vault;
}
