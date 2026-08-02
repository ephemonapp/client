export function toPromise<TypeData>(request: IDBRequest<TypeData>): Promise<TypeData> {
    return new Promise<TypeData>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export function committed(transaction: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

export async function readAll<TypeData>(db: IDBDatabase, storeName: string): Promise<Array<TypeData>> {
    if (!db.objectStoreNames.contains(storeName)) return [];
    const transaction = db.transaction([storeName], 'readonly');
    return (await toPromise(transaction.objectStore(storeName).getAll())) as Array<TypeData>;
}
