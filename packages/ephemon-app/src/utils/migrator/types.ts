import { Cryptography } from '../cryptography';
import { Logger } from '../logger';

export type MigrationContext = {
    db: IDBDatabase;
    cryptography: Cryptography;
    logger: Logger;
    dataKey: CryptoKey;
    password: string;
    report(done: number, total: number): void;
};

export type Migration = {
    id: string;
    schema?(db: IDBDatabase): void;
    data?(context: MigrationContext): Promise<void>;
};
