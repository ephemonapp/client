import { Migration } from '../migrator';
import { m001_vaultV2 } from './001_vaultV2';
import { m002_dropLegacyStores } from './002_dropLegacyStores';
import { m003_numericChatIds } from './003_numericChatIds';
import { m004_dropCacheStore } from './004_dropCacheStore';

export const migrations: ReadonlyArray<Migration> = [
    m001_vaultV2,
    m002_dropLegacyStores,
    m003_numericChatIds,
    m004_dropCacheStore,
];

export { hasLegacyVault, verifyLegacyPassword } from './legacy';
