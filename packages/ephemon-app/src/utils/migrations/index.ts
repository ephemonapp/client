import { Migration } from '../migrator';
import { m001_initialize } from './001_initialize';
import { m002_mlsCommits } from './002_mlsCommits';
import { m003_blocked } from './003_blocked';
import { m004_replaceLegacyVault } from './004_replaceLegacyVault';

export const migrations: ReadonlyArray<Migration> = [
    m001_initialize,
    m002_mlsCommits,
    m003_blocked,
    m004_replaceLegacyVault,
];
