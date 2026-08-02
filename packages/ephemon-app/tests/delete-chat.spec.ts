import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

test.describe('deleting a chat', () => {
    test('takes the conversation off both sides', async ({ browser }) => {
        const alice = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'alice');
        const bob = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'bob');
        try {
            await bob.unlock('close-bob-pass');
            await alice.unlock('close-alice-pass');

            await alice.connectTo(bob.publicKey);
            await alice.waitForConnected();
            await bob.waitForConnected();
            await expect(alice.rows).toHaveCount(1);
            await expect(bob.rows).toHaveCount(1);

            await alice.deleteChatFromKebab();

            await expect(alice.rows).toHaveCount(0);
            await expect(bob.rows).toHaveCount(0, { timeout: 60_000 });
        } finally {
            await alice.close();
            await bob.close();
        }
    });
});
