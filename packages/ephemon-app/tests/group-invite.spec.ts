import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

const PASSWORDS = { master: 'invite-master-pass', peer1: 'invite-peer1-pass', peer2: 'invite-peer2-pass' };

test('a group invite asks first, and can be declined or answered by blocking the contact', async ({ browser }) => {
    const master = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'master');
    const peer1 = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'peer1');
    const peer2 = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'peer2');
    try {
        await peer1.unlock(PASSWORDS.peer1);
        await peer2.unlock(PASSWORDS.peer2);
        await master.unlock(PASSWORDS.master);

        await master.connectTo(peer1.publicKey, peer1);
        await master.waitForConnected();
        await peer1.waitForConnected();
        await master.connectTo(peer2.publicKey, peer2);
        await master.waitForConnected();
        await peer2.waitForConnected();

        await master.createGroupFromSidebar([peer1.publicKey, peer2.publicKey], 'Master');
        await expect(master.groupRow).toHaveCount(1);

        await expect(peer1.groupInvite).toBeVisible({ timeout: 60_000 });
        await expect(peer1.groupRow).toHaveCount(0);
        await peer1.declineGroupInvite();
        await expect(peer1.groupInvite).toHaveCount(0);
        await expect(peer1.groupRow).toHaveCount(0);

        await expect(peer2.groupInvite).toBeVisible({ timeout: 60_000 });
        await peer2.blockGroupInviter();
        await expect(peer2.groupRow).toHaveCount(0);
        await peer2.openBlockedFromSidebar();
        await expect(peer2.blockedRows).toHaveCount(1);
        await expect(peer2.blockedRows.first()).toContainText(master.publicKey.slice(0, 7));
    } finally {
        await master.close();
        await peer1.close();
        await peer2.close();
    }
});
