import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

const PASSWORDS = { master: 'attr-master-pass', peer1: 'attr-peer1-pass', peer2: 'attr-peer2-pass' };

test('a group attributes reactions and receipts to the member behind them', async ({ browser }) => {
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
        await expect(master.groupRow).toContainText('Peer One');
        await expect(master.groupRow).toContainText('Peer Two');

        const fromMaster = `master says ${Date.now()}`;
        await master.sendMessage(fromMaster);
        await expect(peer1.peerBubble(fromMaster)).toHaveCount(1);
        await expect(peer2.peerBubble(fromMaster)).toHaveCount(1);

        await peer1.reactTo(fromMaster, '👍');
        await peer2.reactTo(fromMaster, '👍');
        for (const app of everyone) {
            const chips = app === master ? master.ownReactions(fromMaster) : app.peerReactions(fromMaster);
            await expect(chips).toHaveCount(1);
            await expect(chips.first()).toHaveText('👍 2');
            await expect(chips.first()).toHaveAttribute('title', /Peer One/);
            await expect(chips.first()).toHaveAttribute('title', /Peer Two/);
        }

        await master.openReceiptList(fromMaster);
        await expect(master.receiptRowFor('Peer One')).toContainText('👍');
        await expect(master.receiptRowFor('Peer Two')).toContainText('👍');
        await master.closeReceiptList();

        await peer2.reactTo(fromMaster, '👍');
        for (const app of everyone) {
            const chips = app === master ? master.ownReactions(fromMaster) : app.peerReactions(fromMaster);
            await expect(chips.filter({ hasText: '👍' })).toHaveText('👍');
            await expect(chips.filter({ hasText: '👍' })).toHaveAttribute('title', /Peer One/);
        }

        await peer2.reactTo(fromMaster, '🔥');
        for (const app of [peer1, peer2]) {
            await expect(app.peerReactions(fromMaster)).toHaveCount(1);
            await expect(app.reactionMoreOn(fromMaster)).toHaveCount(1);
        }
        await peer1.openReactionDetails(fromMaster);
        await expect(peer1.receiptRowFor('Peer Two')).toContainText('🔥');
        await peer1.closeReceiptList();
        await peer2.reactTo(fromMaster, '🔥');
        for (const app of [peer1, peer2]) await expect(app.reactionMoreOn(fromMaster)).toHaveCount(0);

        await peer1.scrollMessagesToBottom();
        await peer2.scrollMessagesToBottom();

        await master.openReceiptList(fromMaster);
        await expect(master.receiptRows).toHaveCount(2);
        await expect(master.receiptRowFor('Peer One')).toHaveAttribute('data-state', 'read');
        await expect(master.receiptRowFor('Peer Two')).toHaveAttribute('data-state', 'read');
        await master.closeReceiptList();

        const fromPeer1 = `peer one says ${Date.now()}`;
        await peer1.sendMessage(fromPeer1);
        await expect(master.peerBubble(fromPeer1)).toHaveCount(1);
        await expect(peer2.peerBubble(fromPeer1)).toHaveCount(1);
        await peer1.openReceiptList(fromPeer1);
        await expect(peer1.receiptRowFor('Master')).toHaveAttribute('data-state', 'read');
        await expect(peer1.receiptRowFor('Peer Two')).toHaveAttribute('data-state', 'read');
        await peer1.closeReceiptList();

        await peer2.page.close();
        const whileAway = `master says again ${Date.now()}`;
        await master.sendMessage(whileAway);
        await expect(peer1.peerBubble(whileAway)).toHaveCount(1);
        await master.openReceiptList(whileAway);
        await expect(master.receiptRowFor('Peer One')).toHaveAttribute('data-state', 'read');
        await expect(master.receiptRowFor('Peer Two')).toHaveAttribute('data-state', 'waiting');
        await master.closeReceiptList();
    } finally {
        await master.close();
        await peer1.close();
        await peer2.close();
    }
});
