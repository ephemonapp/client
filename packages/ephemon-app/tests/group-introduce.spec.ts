import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

const PASSWORDS = { master: 'intro-master-pass', peer: 'intro-peer-pass' };

test('a member that has not introduced itself gets the form instead of the conversation', async ({ browser }) => {
    const master = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'master');
    const peer = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'peer');
    try {
        await peer.unlock(PASSWORDS.peer);
        await master.unlock(PASSWORDS.master);

        await master.connectTo(peer.publicKey, peer);
        await master.waitForConnected();
        await peer.waitForConnected();

        await master.createGroupFromSidebar([peer.publicKey], 'Master');
        for (const app of [master, peer]) await expect(app.groupRow).toHaveCount(1);

        await peer.selectGroup();
        await expect(peer.introduceForm).toBeVisible();
        await expect(peer.composer).toHaveCount(0);

        const said = `master to the group ${Date.now()}`;
        await master.selectGroup();
        await master.sendMessage(said);

        const receipt = master.ownBubble(said).locator('.bubble__receipt');
        await expect(receipt).toHaveAttribute('title', /Delivered/);
        await expect(peer.bubbles).toHaveCount(0);
        await expect(receipt).not.toHaveAttribute('title', /Seen/);

        await peer.selectConversation(master.publicKey);
        await expect(peer.composer).toBeVisible();
        await peer.selectGroup();
        await expect(peer.introduceForm).toBeVisible();
        await expect(peer.bubbles).toHaveCount(0);

        await peer.nameSelfInGroup('Peer');
        await expect(peer.introduceForm).toHaveCount(0);
        await expect(peer.peerBubble(said)).toHaveCount(1);
        await expect(peer.composer).toBeEnabled();
        await expect(receipt).toHaveAttribute('title', /Seen/);
        await expect(master.groupName).toHaveText('Peer');

        const back = `peer answers ${Date.now()}`;
        await peer.sendMessage(back);
        await expect(master.peerBubble(back)).toHaveCount(1);
    } finally {
        await master.close();
        await peer.close();
    }
});
