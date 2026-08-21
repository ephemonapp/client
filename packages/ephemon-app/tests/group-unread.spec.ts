import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

const PASSWORDS = { master: 'unread-master-pass', peer1: 'unread-peer1-pass', peer2: 'unread-peer2-pass' };

test('a group carries the same name on every side and counts unread per member', async ({ browser }) => {
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
        for (const app of [master, peer1, peer2]) await expect(app.groupRow).toHaveCount(1);

        await expect(peer1.groupName).toHaveText('Master');
        await expect(peer2.groupName).toHaveText('Master');
        await expect(master.groupName).toHaveText('Group');

        await master.selectGroup();
        const said = `master to the group ${Date.now()}`;
        await master.sendMessage(said);

        await peer1.selectGroup();
        await peer1.nameSelfInGroup('Peer One');
        await expect(peer1.peerBubble(said)).toHaveCount(1);
        const receipt = master.ownBubble(said).locator('.bubble__receipt');
        await expect(receipt).toHaveAttribute('title', /Seen/);

        await peer2.page.reload({ waitUntil: 'domcontentloaded' });
        await peer2.page.waitForSelector('.lock__card');
        await peer2.unlock(PASSWORDS.peer2);
        await expect(peer2.groupUnread).toHaveText('1');

        // A member that never introduced itself gets the form, so the count only clears once it joins for real.
        await peer2.selectGroup();
        await expect(peer2.introduceForm).toBeVisible();
        await expect(peer2.groupUnread).toHaveText('1');
        await peer2.nameSelfInGroup('Peer Two');
        await expect(peer2.peerBubble(said)).toHaveCount(1);
        await expect(peer2.groupUnread).toHaveCount(0);
    } finally {
        await master.close();
        await peer1.close();
        await peer2.close();
    }
});
