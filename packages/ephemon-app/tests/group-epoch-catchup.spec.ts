import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

const PASSWORDS = { master: 'epoch-master-pass', peer1: 'epoch-peer1-pass', peer2: 'epoch-peer2-pass' };

test('a member that missed several epochs is caught up when it comes back', async ({ browser }) => {
    const master = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'master');
    const peer1 = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'peer1');
    const peer2 = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'peer2');
    const everyone = [master, peer1, peer2];
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
        for (const app of everyone) await expect(app.groupRow).toHaveCount(1);
        await peer1.selectGroup();
        await peer1.nameSelfInGroup('Peer One');
        await peer2.selectGroup();
        await peer2.nameSelfInGroup('Peer Two');
        await master.selectGroup();

        const opening = `everyone is here ${Date.now()}`;
        await master.sendMessage(opening);
        await expect(peer1.peerBubble(opening)).toHaveCount(1);
        await expect(peer2.peerBubble(opening)).toHaveCount(1);

        await peer2.leaveApp();
        for (const round of [1, 2]) {
            await master.page.reload({ waitUntil: 'domcontentloaded' });
            await master.page.waitForSelector('.lock__card');
            await master.unlock(PASSWORDS.master);
            await master.selectGroup();
            expect(round).toBeGreaterThan(0);
        }

        await peer1.page.reload({ waitUntil: 'domcontentloaded' });
        await peer1.page.waitForSelector('.lock__card');
        await peer1.unlock(PASSWORDS.peer1);
        await peer1.selectGroup();
        const said = `peer one while peer two was away ${Date.now()}`;
        await peer1.sendMessage(said);
        if (await peer1.retryBanner.isVisible()) {
            await peer1.retryFromBanner();
        } else {
            await peer1.reconnectFromKebab();
        }
        await peer1.waitForConnected();
        await master.scrollMessagesToBottom();
        await expect(master.peerBubble(said)).toHaveCount(1);

        await peer2.returnToApp(AUDIT_ORIGIN, PASSWORDS.peer2);
        await peer2.selectGroup();
        if (await peer2.retryBanner.isVisible()) {
            await peer2.retryFromBanner();
        } else {
            await peer2.reconnectFromKebab();
        }
        await peer2.waitForConnected();
        await peer2.scrollMessagesToBottom();
        await expect(peer2.peerBubble(said)).toHaveCount(1);

        const back = `peer two is back ${Date.now()}`;
        await peer2.sendMessage(back);
        await master.scrollMessagesToBottom();
        await peer1.scrollMessagesToBottom();
        await expect(master.peerBubble(back)).toHaveCount(1);
        await expect(peer1.peerBubble(back)).toHaveCount(1);
    } finally {
        await master.close();
        await peer1.close();
        await peer2.close();
    }
});
