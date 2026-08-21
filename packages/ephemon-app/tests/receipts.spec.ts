import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

test('a message is marked delivered before the recipient looks at it, and read only after', async ({ browser }) => {
    const alice = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'alice');
    const bob = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'bob');
    try {
        await bob.unlock('receipts-bob-pass');
        await alice.unlock('receipts-alice-pass');
        await alice.connectTo(bob.publicKey, bob);
        await alice.waitForConnected();
        await bob.waitForConnected();

        await bob.connectTo(bob.publicKey);
        await expect(bob.rows).toHaveCount(2);
        await bob.selectConversation(bob.publicKey);

        const text = `delivered before read ${Date.now()}`;
        await alice.sendMessage(text);
        const receipt = alice.ownBubble(text).locator('.bubble__receipt');
        await expect(receipt).toHaveAttribute('title', /Delivered/);
        await expect(receipt).not.toHaveAttribute('title', /Seen/);

        await bob.selectConversation(alice.publicKey);
        await expect(bob.peerBubble(text)).toHaveCount(1);
        await expect(receipt).toHaveAttribute('title', /Seen/);
    } finally {
        await alice.close();
        await bob.close();
    }
});
