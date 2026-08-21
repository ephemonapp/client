import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

test('an unwanted caller is declined forever, survives a restart, and can be unblocked', async ({ browser }) => {
    const alice = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'alice');
    const bobPassword = 'blocked-bob-pass';
    const bob = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'bob');
    try {
        await bob.unlock(bobPassword);
        await alice.unlock('blocked-alice-pass');

        await alice.connectTo(bob.publicKey);
        await bob.blockIncomingDial();

        await bob.openBlockedFromSidebar();
        await expect(bob.blockedRows).toHaveCount(1);
        await expect(bob.blockedRows.first()).toContainText(alice.publicKey.slice(0, 7));
        await bob.page.click('.modal-close');

        await bob.page.reload({ waitUntil: 'domcontentloaded' });
        await bob.page.waitForSelector('.lock__card', { timeout: 60_000 });
        await bob.unlock(bobPassword);
        await bob.openBlockedFromSidebar();
        await expect(bob.blockedRows).toHaveCount(1);

        await bob.unblockFromModal();
        await expect(bob.blockedRows).toHaveCount(0);
        await bob.page.click('.modal-close');

        await alice.connectTo(bob.publicKey);
        await bob.acceptIncomingDial();
        await alice.waitForConnected();
        await bob.waitForConnected();
    } finally {
        await alice.close();
        await bob.close();
    }
});
