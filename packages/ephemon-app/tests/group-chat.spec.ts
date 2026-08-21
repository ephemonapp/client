import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

test('a group is created from contacts and carries messages between its members', async ({ browser }) => {
    const alicePassword = 'group-alice-pass';
    const alice = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'alice');
    const bob = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'bob');
    const carol = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'carol');
    try {
        await carol.unlock('group-carol-pass');
        await bob.unlock('group-bob-pass');
        await alice.unlock(alicePassword);

        await alice.connectTo(bob.publicKey, bob);
        await alice.waitForConnected();
        await bob.waitForConnected();
        const toBob = `direct to bob ${Date.now()}`;
        await alice.sendMessage(toBob);
        await expect(bob.peerBubble(toBob)).toHaveCount(1);

        await alice.connectTo(carol.publicKey, carol);
        await alice.waitForConnected();
        await carol.waitForConnected();
        const toCarol = `direct to carol ${Date.now()}`;
        await alice.sendMessage(toCarol);
        await expect(carol.peerBubble(toCarol)).toHaveCount(1);

        await alice.createGroupFromSidebar([bob.publicKey, carol.publicKey], 'Alice');
        await expect(alice.groupRow).toHaveCount(1);
        await expect(bob.groupRow).toHaveCount(1);
        await expect(carol.groupRow).toHaveCount(1);

        await expect(bob.groupName).toHaveText('Alice');
        await expect(carol.groupName).toHaveText('Alice');

        await bob.selectGroup();
        await bob.nameSelfInGroup('Bob');
        await carol.selectGroup();
        await carol.nameSelfInGroup('Carol');
        await alice.selectGroup();

        await expect(alice.groupRow).toContainText('Bob');
        await expect(alice.groupRow).toContainText('Carol');
        await expect(bob.groupRow).toContainText('Alice');

        const toAll = `hello group ${Date.now()}`;
        await alice.sendMessage(toAll);
        await expect(bob.peerBubble(toAll)).toHaveCount(1);
        await expect(carol.peerBubble(toAll)).toHaveCount(1);

        const fromCarol = `carol in the group ${Date.now()}`;
        await carol.sendMessage(fromCarol);
        await expect(alice.peerBubble(fromCarol)).toHaveCount(1);

        await expect(alice.authorLine('Carol')).toHaveCount(1);
        await alice.authorLine('Carol').first().click();
        await expect(alice.page.locator('.qr__key')).toContainText(carol.publicKey.slice(0, 7));
        await alice.page.click('.modal-close');

        const fromBob = `bob in the group ${Date.now()}`;
        await bob.sendMessage(fromBob);
        await expect(alice.peerBubble(fromBob)).toHaveCount(1);
        await expect(carol.peerBubble(fromBob)).toHaveCount(1);
        await expect(carol.authorLine('Bob')).toHaveCount(1);
        await expect(bob.peerBubble(fromCarol)).toHaveCount(1);

        await alice.page.reload({ waitUntil: 'domcontentloaded' });
        await alice.page.waitForSelector('.lock__card');
        await alice.unlock(alicePassword);
        await alice.selectGroup();
        await alice.reconnectFromKebab();
        await alice.waitForConnected();

        const afterRestart = `owner is back ${Date.now()}`;
        await alice.sendMessage(afterRestart);
        await bob.scrollMessagesToBottom();
        await carol.scrollMessagesToBottom();
        await expect(bob.peerBubble(afterRestart)).toHaveCount(1);
        await expect(carol.peerBubble(afterRestart)).toHaveCount(1);

        const afterRestartFromBob = `bob after the owner restarted ${Date.now()}`;
        await bob.sendMessage(afterRestartFromBob);
        await alice.scrollMessagesToBottom();
        await carol.scrollMessagesToBottom();
        await expect(alice.peerBubble(afterRestartFromBob)).toHaveCount(1);
        await expect(carol.peerBubble(afterRestartFromBob)).toHaveCount(1);

        const directAgain = `direct to bob again ${Date.now()}`;
        await alice.selectConversation(bob.publicKey);
        await alice.sendMessage(directAgain);
        await bob.selectConversation(alice.publicKey);
        await expect(bob.peerBubble(directAgain)).toHaveCount(1);
        await expect(bob.peerBubble(fromBob)).toHaveCount(0);
    } finally {
        await alice.close();
        await bob.close();
        await carol.close();
    }
});
