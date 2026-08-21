import { ChatEventRecord } from '../types/chatRecord';
import { Bytes, Cryptography, KDF_ITERATIONS, WrappedKey } from './cryptography';
import { committed, readAll, toPromise } from './idb';
import { Logger } from './logger';
import { migrations } from './migrations';
import { ensureMigrationStore, pendingMigrations, runDataPhase, runSchemaPhase } from './migrator';
import { REQUIRED_STORES, STORE_MESSAGES, STORE_META, STORE_MLS_CHECKPOINTS, STORE_MLS_COMMITS } from './stores';

export type DatabaseConfig = {
    dbName: string;
};

export type RecordKey = string | number;

export type UnlockResult = 'valid' | 'invalid' | 'none';

export type UnlockHandlers = {
    onMigrating?: () => void;
    onProgress?: (done: number, total: number) => void;
};

export class VaultUnavailableError extends Error {}

export class VaultBlockedError extends Error {}

export class VaultStaleError extends Error {}

export class MlsCheckpointConflictError extends Error {}

const META_ID = 'vault';

type MetaRecord = {
    id: string;
    kdf: { salt: Bytes; iterations: number; hash: string };
    wrapped: WrappedKey;
};

type EncryptedRow = {
    id: RecordKey;
    iv: Bytes;
    data: ArrayBuffer;
};

type MessageRow = {
    c: number;
    n: number;
    iv: Bytes;
    data: ArrayBuffer;
};

type MlsCheckpointRow = EncryptedRow & {
    id: number;
    revision: number;
};

type MlsCheckpointEnvelope = {
    id: number;
    revision: number;
    checkpoint: Array<number>;
    companion?: Array<number>;
    chain?: Array<number>;
};

export type StoredMlsCommit = {
    epoch: string;
    authenticator: Uint8Array<ArrayBuffer>;
    parentEpoch?: string;
    parentAuthenticator?: Uint8Array<ArrayBuffer>;
    commit: Uint8Array<ArrayBuffer>;
};

type MlsCommitEnvelope = {
    epoch: string;
    authenticator: Array<number>;
    parentEpoch?: string;
    parentAuthenticator?: Array<number>;
    commit: Array<number>;
};

export type StoredMlsCheckpoint = {
    revision: number;
    checkpoint: Uint8Array<ArrayBuffer>;
    companion?: Uint8Array<ArrayBuffer>;
    chain?: Uint8Array<ArrayBuffer>;
};

export interface Database {
    initialize(config: DatabaseConfig): void;

    unlock(password: string, handlers?: UnlockHandlers): Promise<UnlockResult>;

    lock(): void;

    close(): void;

    isUnlocked(): boolean;

    set<TypeData>(table: string, id: RecordKey, value: TypeData): Promise<void>;

    get<TypeData>(table: string, id: RecordKey): Promise<TypeData | null>;

    getAll<TypeData>(table: string): Promise<Array<{ id: RecordKey; value: TypeData }>>;

    delete(table: string, id: RecordKey): Promise<void>;

    clear(table: string): Promise<void>;

    getMessages(chatId: number): Promise<Array<ChatEventRecord>>;

    putMessages(chatId: number, upserts: ReadonlyArray<ChatEventRecord>, deletes: ReadonlyArray<string>): Promise<void>;

    clearMessages(chatId: number): Promise<void>;

    getMlsCheckpoint(conversationId: number): Promise<StoredMlsCheckpoint | null>;

    putMlsCheckpoint(
        conversationId: number,
        expectedRevision: number | null,
        checkpoint: Uint8Array,
        companion?: Uint8Array,
        chain?: Uint8Array,
    ): Promise<number>;

    deleteMlsCheckpoint(conversationId: number): Promise<void>;

    getMlsCommits(conversationId: number): Promise<Array<StoredMlsCommit>>;

    appendMlsCommit(conversationId: number, commit: StoredMlsCommit): Promise<void>;

    deleteMlsCommits(conversationId: number): Promise<void>;
}

function messageRowKey(record: ChatEventRecord): string {
    return record.id;
}

function chatRange(chatId: number): IDBKeyRange {
    return IDBKeyRange.bound([chatId], [chatId, []]);
}

export default function getDatabase(logger: Logger, cryptography: Cryptography): Database {
    let initialName: string | undefined;
    let db: IDBDatabase | null = null;
    let openPromise: Promise<IDBDatabase> | null = null;
    let dataKey: CryptoKey | null = null;
    let stale = false;

    const messageIndexes = new Map<number, Map<string, number>>();

    function request(name: string, version?: number): Promise<IDBDatabase> {
        return new Promise<IDBDatabase>((resolve, reject) => {
            let settled = false;
            const open = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);

            open.onupgradeneeded = () => {
                const upgraded = open.result;
                ensureMigrationStore(upgraded);
                runSchemaPhase(upgraded, open.transaction!, migrations, logger);
            };

            open.onblocked = () => {
                if (settled) return;
                settled = true;
                logger.warn('[database] indexedDB upgrade is blocked by another tab.');
                reject(new VaultBlockedError('Another tab is holding an older version of the vault open.'));
            };

            open.onsuccess = () => {
                if (settled) {
                    open.result.close();
                    return;
                }
                settled = true;
                resolve(open.result);
            };

            open.onerror = () => {
                if (settled) return;
                settled = true;
                reject(open.error);
            };
        });
    }

    async function connect(): Promise<IDBDatabase> {
        const name = initialName;
        if (name === undefined || name === null) {
            const error = '[database] indexedDB has not been initialized yet.';
            logger.error(error);
            throw new Error(error);
        }
        if (typeof indexedDB === 'undefined') {
            throw new VaultUnavailableError('This browser does not expose indexedDB.');
        }

        let opened: IDBDatabase;
        try {
            opened = stale ? await request(name) : await request(name, +process.env.EPHEMON_BUILD_TIMESTAMP);
        } catch (error) {
            if (error instanceof VaultBlockedError) throw error;
            if ((error as DOMException | null)?.name === 'VersionError') {
                stale = true;
                opened = await request(name);
            } else {
                throw new VaultUnavailableError(`indexedDB could not be opened: ${(error as Error)?.message}`);
            }
        }

        const missing = REQUIRED_STORES.filter((store) => !opened.objectStoreNames.contains(store));
        const canMigrateMissingStores = missing.length > 0 && (await pendingMigrations(opened, migrations)).length > 0;
        if (missing.length > 0 && !canMigrateMissingStores) {
            opened.close();
            throw new VaultStaleError(`This tab is older than the stored vault (missing ${missing.join(', ')}).`);
        }

        return attach(opened);
    }

    function attach(opened: IDBDatabase): IDBDatabase {
        opened.onversionchange = () => {
            logger.warn('[database] Another tab is upgrading the vault; closing this connection.');
            stale = true;
            opened.close();
            if (db === opened) {
                db = null;
                openPromise = null;
            }
        };
        opened.onclose = () => {
            if (db === opened) {
                db = null;
                openPromise = null;
            }
        };

        db = opened;
        return opened;
    }

    async function reopenAtNextVersion(current: IDBDatabase): Promise<IDBDatabase> {
        const name = initialName!;
        const next = current.version + 1;
        current.close();
        db = null;
        openPromise = null;
        return attach(await request(name, next));
    }

    async function drainMigrations(current: IDBDatabase, password: string, handlers?: UnlockHandlers): Promise<void> {
        for (let round = 0; round <= migrations.length; round++) {
            const before = await pendingMigrations(current, migrations);
            if (before.length === 0) return;

            await runDataPhase(
                {
                    db: current,
                    cryptography,
                    logger,
                    dataKey: requireKey(),
                    password,
                    report: (done, total) => handlers?.onProgress?.(done, total),
                },
                migrations,
            );

            const after = await pendingMigrations(current, migrations);
            if (after.length === 0) return;
            if (after.length === before.length) {
                throw new Error('[database] Migrations stopped making progress.');
            }
            current = await reopenAtNextVersion(current);
        }
        throw new Error('[database] Migrations did not converge.');
    }

    function open(): Promise<IDBDatabase> {
        if (db !== null) return Promise.resolve(db);
        if (openPromise !== null) return openPromise;
        openPromise = connect().catch((error) => {
            openPromise = null;
            throw error;
        });
        return openPromise;
    }

    function requireKey(): CryptoKey {
        if (dataKey === null) {
            const error = '[database] The vault is locked.';
            logger.error(error);
            throw new Error(error);
        }
        return dataKey;
    }

    async function readMeta(database: IDBDatabase): Promise<MetaRecord | null> {
        const transaction = database.transaction([STORE_META], 'readonly');
        const record = await toPromise<MetaRecord | undefined>(transaction.objectStore(STORE_META).get(META_ID));
        return record ?? null;
    }

    async function writeMeta(database: IDBDatabase, record: MetaRecord): Promise<void> {
        const transaction = database.transaction([STORE_META], 'readwrite');
        transaction.objectStore(STORE_META).put(record);
        await committed(transaction);
    }

    async function createVaultKey(database: IDBDatabase, password: string): Promise<CryptoKey> {
        const salt = cryptography.getSalt();
        const kek = await cryptography.deriveKek(password, salt, KDF_ITERATIONS);
        const { dataKey: created, wrapped } = await cryptography.createDataKey(kek);
        await writeMeta(database, {
            id: META_ID,
            kdf: { salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
            wrapped,
        });
        return created;
    }

    return {
        initialize(config: DatabaseConfig) {
            logger.debug(`[database] Initialized indexedDB with name ${config.dbName}.`);
            initialName = config.dbName;
        },

        async unlock(password: string, handlers?: UnlockHandlers): Promise<UnlockResult> {
            const database = await open();

            if (password === '') return 'none';

            const meta = await readMeta(database);
            if (meta !== null) {
                try {
                    const kek = await cryptography.deriveKek(password, meta.kdf.salt, meta.kdf.iterations);
                    dataKey = await cryptography.unwrapDataKey(kek, meta.wrapped);
                } catch {
                    return 'invalid';
                }
            } else {
                dataKey = await createVaultKey(database, password);
            }

            if ((await pendingMigrations(database, migrations)).length > 0) {
                handlers?.onMigrating?.();
                await drainMigrations(database, password, handlers);
            }

            return 'valid';
        },

        lock() {
            dataKey = null;
            messageIndexes.clear();
        },

        close() {
            dataKey = null;
            messageIndexes.clear();
            db?.close();
            db = null;
            openPromise = null;
        },

        isUnlocked() {
            return dataKey !== null;
        },

        async set<TypeData>(table: string, id: RecordKey, value: TypeData): Promise<void> {
            const database = await open();
            const { iv, data } = await cryptography.encrypt(requireKey(), { id, value });
            const transaction = database.transaction([table], 'readwrite');
            transaction.objectStore(table).put({ id, iv, data } satisfies EncryptedRow);
            await committed(transaction);
            logger.debug(`[database] Data with key '${id}' encrypted and saved into table '${table}'.`);
        },

        async get<TypeData>(table: string, id: RecordKey): Promise<TypeData | null> {
            const database = await open();
            const key = requireKey();
            const transaction = database.transaction([table], 'readonly');
            const row = await toPromise<EncryptedRow | undefined>(transaction.objectStore(table).get(id));
            if (row === undefined) {
                logger.debug(`[database] Data with key '${id}' not found in table '${table}'.`);
                return null;
            }
            const decoded = await cryptography.decrypt<{ id: RecordKey; value: TypeData }>(key, {
                iv: row.iv,
                data: row.data,
            });
            if (decoded.id !== id) {
                throw new Error(`[database] Row '${id}' in table '${table}' carries a mismatched key.`);
            }
            return decoded.value;
        },

        async getAll<TypeData>(table: string): Promise<Array<{ id: RecordKey; value: TypeData }>> {
            const database = await open();
            const key = requireKey();
            const rows = await readAll<EncryptedRow>(database, table);
            const results: Array<{ id: RecordKey; value: TypeData }> = [];
            for (const row of rows) {
                results.push(
                    await cryptography.decrypt<{ id: RecordKey; value: TypeData }>(key, {
                        iv: row.iv,
                        data: row.data,
                    }),
                );
            }
            return results;
        },

        async delete(table: string, id: RecordKey): Promise<void> {
            const database = await open();
            const transaction = database.transaction([table], 'readwrite');
            transaction.objectStore(table).delete(id);
            await committed(transaction);
            logger.debug(`[database] Data with key '${id}' deleted from table '${table}'.`);
        },

        async clear(table: string): Promise<void> {
            const database = await open();
            const transaction = database.transaction([table], 'readwrite');
            transaction.objectStore(table).clear();
            await committed(transaction);
            logger.debug(`[database] All keys in table '${table}' cleared.`);
        },

        async getMessages(chatId: number): Promise<Array<ChatEventRecord>> {
            const database = await open();
            const key = requireKey();
            const transaction = database.transaction([STORE_MESSAGES], 'readonly');
            const rows = await toPromise<Array<MessageRow>>(
                transaction.objectStore(STORE_MESSAGES).getAll(chatRange(chatId)),
            );

            const index = new Map<string, number>();
            const messages: Array<ChatEventRecord> = [];
            for (const row of rows) {
                try {
                    const message = await cryptography.decrypt<ChatEventRecord>(key, {
                        iv: row.iv,
                        data: row.data,
                    });
                    index.set(messageRowKey(message), row.n);
                    messages.push(message);
                } catch (error) {
                    logger.error(`[database] Skipping unreadable message row ${chatId}/${row.n}.`, error);
                }
            }
            messageIndexes.set(chatId, index);
            return messages;
        },

        async putMessages(
            chatId: number,
            upserts: ReadonlyArray<ChatEventRecord>,
            deletes: ReadonlyArray<string>,
        ): Promise<void> {
            if (upserts.length === 0 && deletes.length === 0) return;
            const database = await open();
            const key = requireKey();

            let index = messageIndexes.get(chatId);
            if (index === undefined) {
                index = new Map<string, number>();
                messageIndexes.set(chatId, index);
            }

            const prepared: Array<{ key: string; iv: Bytes; data: ArrayBuffer }> = [];
            for (const message of upserts) {
                if (message.kind === 'message' && message.sender === 'date') continue;
                const { iv, data } = await cryptography.encrypt(key, message);
                prepared.push({ key: messageRowKey(message), iv, data });
            }

            const assigned = new Map<string, number>();
            const removed: Array<string> = [];

            await new Promise<void>((resolve, reject) => {
                const transaction = database.transaction([STORE_MESSAGES], 'readwrite');
                const store = transaction.objectStore(STORE_MESSAGES);
                const cursor = store.openCursor(chatRange(chatId), 'prev');
                cursor.onsuccess = () => {
                    const last = cursor.result;
                    let next = last === null ? 0 : ((last.key as Array<number>)[1] as number) + 1;
                    for (const item of prepared) {
                        let n = index.get(item.key) ?? assigned.get(item.key);
                        if (n === undefined) {
                            n = next++;
                            assigned.set(item.key, n);
                        }
                        store.put({ c: chatId, n, iv: item.iv, data: item.data } satisfies MessageRow);
                    }
                    for (const messageKey of deletes) {
                        const n = index.get(messageKey);
                        if (n === undefined) continue;
                        store.delete([chatId, n]);
                        removed.push(messageKey);
                    }
                };
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => reject(transaction.error);
            });

            for (const [messageKey, n] of assigned) {
                index.set(messageKey, n);
            }
            for (const messageKey of removed) {
                index.delete(messageKey);
            }
        },

        async clearMessages(chatId: number): Promise<void> {
            const database = await open();
            const transaction = database.transaction([STORE_MESSAGES], 'readwrite');
            transaction.objectStore(STORE_MESSAGES).delete(chatRange(chatId));
            await committed(transaction);
            messageIndexes.delete(chatId);
        },

        async getMlsCheckpoint(conversationId: number): Promise<StoredMlsCheckpoint | null> {
            const database = await open();
            const key = requireKey();
            const transaction = database.transaction([STORE_MLS_CHECKPOINTS], 'readonly');
            const row = await toPromise<MlsCheckpointRow | undefined>(
                transaction.objectStore(STORE_MLS_CHECKPOINTS).get(conversationId),
            );
            if (row === undefined) return null;
            const envelope = await cryptography.decrypt<MlsCheckpointEnvelope>(key, {
                iv: row.iv,
                data: row.data,
            });
            if (envelope.id !== conversationId || envelope.revision !== row.revision) {
                throw new Error(`[database] MLS checkpoint '${conversationId}' carries mismatched metadata.`);
            }
            return {
                revision: row.revision,
                checkpoint: Uint8Array.from(envelope.checkpoint),
                companion: envelope.companion === undefined ? undefined : Uint8Array.from(envelope.companion),
                chain: envelope.chain === undefined ? undefined : Uint8Array.from(envelope.chain),
            };
        },

        async putMlsCheckpoint(
            conversationId: number,
            expectedRevision: number | null,
            checkpoint: Uint8Array,
            companion?: Uint8Array,
            chain?: Uint8Array,
        ): Promise<number> {
            const database = await open();
            const revision = (expectedRevision ?? 0) + 1;
            const key = requireKey();
            const { iv, data } = await cryptography.encrypt(key, {
                id: conversationId,
                revision,
                checkpoint: Array.from(checkpoint),
                companion: companion === undefined ? undefined : Array.from(companion),
                chain: chain === undefined ? undefined : Array.from(chain),
            } satisfies MlsCheckpointEnvelope);

            await new Promise<void>((resolve, reject) => {
                const transaction = database.transaction([STORE_MLS_CHECKPOINTS], 'readwrite');
                const store = transaction.objectStore(STORE_MLS_CHECKPOINTS);
                let conflict = false;
                const request = store.get(conversationId);
                request.onsuccess = () => {
                    const current = request.result as MlsCheckpointRow | undefined;
                    if ((current?.revision ?? null) !== expectedRevision) {
                        conflict = true;
                        transaction.abort();
                        return;
                    }
                    store.put({ id: conversationId, revision, iv, data } satisfies MlsCheckpointRow);
                };
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () =>
                    reject(
                        conflict
                            ? new MlsCheckpointConflictError(
                                  `MLS checkpoint '${conversationId}' changed in another writer.`,
                              )
                            : transaction.error,
                    );
            });
            return revision;
        },

        async getMlsCommits(conversationId: number): Promise<Array<StoredMlsCommit>> {
            const database = await open();
            const key = requireKey();
            const transaction = database.transaction([STORE_MLS_COMMITS], 'readonly');
            const rows = await toPromise<Array<MessageRow>>(
                transaction.objectStore(STORE_MLS_COMMITS).getAll(chatRange(conversationId)),
            );
            const commits: Array<StoredMlsCommit> = [];
            for (const row of rows) {
                const envelope = await cryptography.decrypt<MlsCommitEnvelope>(key, {
                    iv: row.iv,
                    data: row.data,
                });
                commits.push({
                    epoch: envelope.epoch,
                    authenticator: Uint8Array.from(envelope.authenticator),
                    parentEpoch: envelope.parentEpoch,
                    parentAuthenticator:
                        envelope.parentAuthenticator === undefined
                            ? undefined
                            : Uint8Array.from(envelope.parentAuthenticator),
                    commit: Uint8Array.from(envelope.commit),
                });
            }
            return commits;
        },

        async appendMlsCommit(conversationId: number, commit: StoredMlsCommit): Promise<void> {
            const database = await open();
            const key = requireKey();
            const { iv, data } = await cryptography.encrypt(key, {
                epoch: commit.epoch,
                authenticator: Array.from(commit.authenticator),
                parentEpoch: commit.parentEpoch,
                parentAuthenticator:
                    commit.parentAuthenticator === undefined ? undefined : Array.from(commit.parentAuthenticator),
                commit: Array.from(commit.commit),
            } satisfies MlsCommitEnvelope);
            await new Promise<void>((resolve, reject) => {
                const transaction = database.transaction([STORE_MLS_COMMITS], 'readwrite');
                const store = transaction.objectStore(STORE_MLS_COMMITS);
                const cursor = store.openCursor(chatRange(conversationId), 'prev');
                cursor.onsuccess = () => {
                    const last = cursor.result;
                    const n = last === null ? 0 : ((last.key as Array<number>)[1] as number) + 1;
                    store.put({ c: conversationId, n, iv, data } satisfies MessageRow);
                };
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => reject(transaction.error);
            });
        },

        async deleteMlsCommits(conversationId: number): Promise<void> {
            const database = await open();
            const transaction = database.transaction([STORE_MLS_COMMITS], 'readwrite');
            transaction.objectStore(STORE_MLS_COMMITS).delete(chatRange(conversationId));
            await committed(transaction);
        },

        async deleteMlsCheckpoint(conversationId: number): Promise<void> {
            const database = await open();
            const transaction = database.transaction([STORE_MLS_CHECKPOINTS], 'readwrite');
            transaction.objectStore(STORE_MLS_CHECKPOINTS).delete(conversationId);
            await committed(transaction);
        },
    };
}
