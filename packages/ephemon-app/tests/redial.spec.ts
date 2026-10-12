import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

test('a conversation deleted and dialled again carries messages instead of swallowing them', async ({ browser }) => {
    const alice = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'alice');
    const bob = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'bob');
    try {
        await bob.unlock('redial-bob-pass');
        await alice.unlock('redial-alice-pass');
        await alice.connectTo(bob.publicKey, bob);
        await alice.waitForConnected();
        await bob.waitForConnected();

        const before = `before the delete ${Date.now()}`;
        await alice.sendMessage(before);
        await expect(bob.peerBubble(before)).toHaveCount(1, { timeout: 60_000 });

        await alice.deleteChatFromKebab();
        await expect(alice.rows).toHaveCount(0);
        await expect(bob.rows).toHaveCount(0);

        await alice.connectTo(bob.publicKey, bob);
        await alice.waitForConnected();

        const after = `after the redial ${Date.now()}`;
        await alice.sendMessage(after);
        await expect(alice.ownBubble(after)).toBeVisible();
        await expect(bob.peerBubble(after)).toHaveCount(1, { timeout: 60_000 });
    } finally {
        await alice.close();
        await bob.close();
    }
});
