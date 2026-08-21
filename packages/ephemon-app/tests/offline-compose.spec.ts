import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

test('an MLS message composed while disconnected is authored locally and delivered after retry', async ({
    browser,
}) => {
    const alicePassword = 'offline-alice-pass';
    const alice = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'alice');
    const bob = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'bob');
    try {
        await bob.unlock('offline-bob-pass');
        await alice.unlock(alicePassword);
        await alice.connectTo(bob.publicKey, bob);
        await alice.waitForConnected();
        await bob.waitForConnected();

        const online = `online mls message ${Date.now()}`;
        await alice.sendMessage(online);
        await expect(bob.peerBubble(online)).toHaveCount(1, { timeout: 60_000 });

        await alice.page.reload({ waitUntil: 'domcontentloaded' });
        await alice.page.waitForSelector('.lock__card', { timeout: 60_000 });
        await alice.unlock(alicePassword);
        await alice.selectConversation(bob.publicKey);

        const text = `offline mls message ${Date.now()}`;
        await alice.sendMessage(text);
        const own = alice.ownBubble(text);
        await expect(own).toHaveCount(1);
        await expect(own.locator('.bubble__retry')).toBeVisible({ timeout: 15_000 });

        await own.locator('.bubble__retry').click();
        await alice.waitForConnected();
        await expect(bob.peerBubble(text)).toHaveCount(1, { timeout: 60_000 });
        await expect(own.locator('.bubble__retry')).toHaveCount(0);
        await expect(own.locator('.bubble__receipt')).toHaveAttribute('title', /^Delivered /);
    } finally {
        await alice.close();
        await bob.close();
    }
});
