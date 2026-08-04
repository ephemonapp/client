import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

test.describe('deleting a chat', () => {
    test('takes the conversation off both sides', async ({ browser }) => {
        const alice = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'alice');
        const bob = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'bob');
        const sendErrors: Array<string> = [];
        for (const app of [alice, bob]) {
            app.page.on('console', (message) => {
                if (message.text().includes('[connection-saga] Error sending data')) {
                    sendErrors.push(`[${app.label}] ${message.text()}`);
                }
            });
        }
        try {
            await bob.unlock('close-bob-pass');
            await alice.unlock('close-alice-pass');

            const aliceWasmLoaded = alice.page.waitForResponse(
                (response) => response.url().endsWith('/mls.wasm') && response.status() === 200,
                { timeout: 60_000 },
            );
            const bobWasmLoaded = bob.page.waitForResponse(
                (response) => response.url().endsWith('/mls.wasm') && response.status() === 200,
                { timeout: 60_000 },
            );
            await alice.connectTo(bob.publicKey);
            await alice.waitForConnected();
            await bob.waitForConnected();
            await Promise.all([aliceWasmLoaded, bobWasmLoaded]);
            await expect(alice.rows).toHaveCount(1);
            await expect(bob.rows).toHaveCount(1);

            const text = `real MLS direct message typed without queue amplification ${Date.now()}`;
            await alice.typeAndSend(text);
            await expect(bob.peerBubble(text)).toHaveCount(1, { timeout: 60_000 });
            await bob.reactTo(text, '👍');
            await expect(alice.ownBubble(text).locator('.bubble__reaction')).toContainText('👍');
            await alice.page.waitForTimeout(500);
            expect(sendErrors).toEqual([]);

            const aliceCheckpointRevisions = await alice.page.evaluate(
                () =>
                    new Promise<Array<number>>((resolve, reject) => {
                        const request = indexedDB.open('ephemon');
                        request.onerror = () => reject(request.error);
                        request.onsuccess = () => {
                            const transaction = request.result.transaction('mls_checkpoints', 'readonly');
                            const rows = transaction.objectStore('mls_checkpoints').getAll();
                            rows.onerror = () => reject(rows.error);
                            rows.onsuccess = () =>
                                resolve(rows.result.map((row) => Number((row as { revision: number }).revision)));
                        };
                    }),
            );
            expect(aliceCheckpointRevisions).toHaveLength(1);
            expect(Math.max(...aliceCheckpointRevisions)).toBeLessThan(30);

            await alice.deleteChatFromKebab();

            await expect(alice.rows).toHaveCount(0);
            await expect(bob.rows).toHaveCount(0, { timeout: 60_000 });
        } finally {
            await alice.close();
            await bob.close();
        }
    });
});
