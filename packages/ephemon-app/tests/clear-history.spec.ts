import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

test('clearing history is durable and leaves the conversation able to send', async ({ browser }) => {
    const alicePassword = 'clear-alice-pass';
    const alice = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'alice');
    const bob = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'bob');
    try {
        await bob.unlock('clear-bob-pass');
        await alice.unlock(alicePassword);
        await alice.connectTo(bob.publicKey, bob);
        await alice.waitForConnected();
        await bob.waitForConnected();

        const fromAlice = `alice before clearing ${Date.now()}`;
        await alice.sendMessage(fromAlice);
        await expect(bob.peerBubble(fromAlice)).toHaveCount(1, { timeout: 60_000 });

        const fromBob = `bob before clearing ${Date.now()}`;
        await bob.sendMessage(fromBob);
        await expect(alice.peerBubble(fromBob)).toHaveCount(1, { timeout: 60_000 });

        await alice.clearHistoryFromKebab();
        await expect(alice.bubbles).toHaveCount(0);
        await expect(bob.bubbles).not.toHaveCount(0);

        await alice.reconnectFromKebab();
        await alice.waitForConnected();
        await alice.page.waitForTimeout(3_000);
        await expect(alice.bubbles).toHaveCount(0);

        await bob.page.reload({ waitUntil: 'domcontentloaded' });
        await bob.page.waitForSelector('.lock__card', { timeout: 60_000 });
        await bob.unlock('clear-bob-pass');
        await bob.selectConversation(alice.publicKey);

        await alice.page.reload({ waitUntil: 'domcontentloaded' });
        await alice.page.waitForSelector('.lock__card', { timeout: 60_000 });
        await alice.unlock(alicePassword);
        await alice.selectConversation(bob.publicKey);
        await alice.reconnectFromKebab();
        await alice.waitForConnected();
        await bob.waitForConnected();
        await alice.page.waitForTimeout(3_000);
        await expect(alice.ownBubble(fromAlice)).toHaveCount(0);
        await expect(alice.peerBubble(fromBob)).toHaveCount(0);
        await expect(bob.peerBubble(fromAlice)).toHaveCount(1);

        const afterClear = `alice after clearing ${Date.now()}`;
        await alice.sendMessage(afterClear);
        await expect(bob.peerBubble(afterClear)).toHaveCount(1, { timeout: 60_000 });

        const bobAfterClear = `bob after clearing ${Date.now()}`;
        await bob.sendMessage(bobAfterClear);
        await expect(alice.peerBubble(bobAfterClear)).toHaveCount(1, { timeout: 60_000 });
    } finally {
        await alice.close();
        await bob.close();
    }
});
