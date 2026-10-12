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

        await bob.restart(bobPassword);
        await bob.openBlockedFromSidebar();
        await expect(bob.blockedRows).toHaveCount(1);

        await bob.page.click('.modal-close');
        await alice.connectTo(bob.publicKey);
        await bob.page.waitForTimeout(5_000);
        await expect(bob.page.locator('.dial__accept')).toHaveCount(0);

        await bob.openBlockedFromSidebar();
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
