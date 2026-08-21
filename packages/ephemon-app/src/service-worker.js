function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ephemon-sw', 1);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('delayedPayloads')) {
                db.createObjectStore('delayedPayloads', { keyPath: 'id', autoIncrement: true });
            }
        };

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

async function addPushToDB(payload) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('delayedPayloads', 'readwrite');
        const store = tx.objectStore('delayedPayloads');
        store.add({ payload });
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => reject(event.target.error);
    });
}

async function getAllPushesFromDB() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('delayedPayloads', 'readonly');
        const store = tx.objectStore('delayedPayloads');
        const request = store.getAll();
        request.onsuccess = () => {
            resolve(request.result);
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

async function clearAllPushesFromDB() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('delayedPayloads', 'readwrite');
        const store = tx.objectStore('delayedPayloads');
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => reject(event.target.error);
    });
}

console.log('[service-worker] Version __EPHEMON_BUILD_TIMESTAMP__.');

async function sendMessage(payload) {
    const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
    });

    if (clientList.length === 0) {
        console.debug('[service-worker] Push data saved in IDB. No clients available.', payload);
        await addPushToDB(payload);
        return;
    }

    clientList.forEach((client) => {
        console.debug('[service-worker] Sending message', client, payload);
        client.postMessage({
            type: 'PUSH_NOTIFICATION',
            payload: payload,
        });
    });
}

self.addEventListener('push', function (event) {
    const data = event.data.json();
    console.log('[service-worker] Received native push.', data);

    event.waitUntil(
        (async () => {
            if (data?.title) {
                await self.registration.showNotification(data.title, data);
            }
            await sendMessage(data);
        })(),
    );
});

self.addEventListener('install', (event) => {
    const replacing = self.registration.active !== null;
    event.waitUntil(
        (async () => {
            if (!replacing) return;
            for (const client of await self.clients.matchAll({ type: 'window' })) {
                client.postMessage({ type: 'NEW_VERSION_AVAILABLE' });
            }
        })(),
    );
    self.skipWaiting();
    console.log('[service-worker] Installed.');
});

self.addEventListener('activate', (event) => {
    self.skipWaiting();
    event.waitUntil(self.clients.claim());
    console.log('[service-worker] Activated.');
});

self.addEventListener('notificationclick', function (event) {
    let url = self.registration.scope;
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (let client of windowClients) {
                if (client.url.startsWith(url) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(url);
            }
        }),
    );
    self.skipWaiting();
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CLIENT_READY') {
        event.waitUntil(
            (async () => {
                const storedPushes = await getAllPushesFromDB();
                if (storedPushes && storedPushes.length > 0) {
                    for (const record of storedPushes) {
                        console.debug('[service-worker] Delivering delayed push data from DB.', record.payload);
                        event.source.postMessage({
                            type: 'PUSH_NOTIFICATION',
                            payload: record.payload,
                        });
                    }
                    await clearAllPushesFromDB();
                }
            })(),
        );
    }

    if (event.data && event.data.type === 'SHOW_NOTIFICATION' && event.data.title) {
        console.debug('[service-worker] Showing notification.');
        event.waitUntil(self.registration.showNotification(event.data.title, event.data.options));
    }

    self.skipWaiting();
});
