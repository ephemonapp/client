import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

const PASSWORDS = { master: 'mesh-master-pass', peer1: 'mesh-peer1-pass', peer2: 'mesh-peer2-pass' };

test('a group of three carries messages, replies and reactions, and survives each member restarting', async ({
    browser,
}) => {
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
        await expect(peer1.groupRow).toContainText('Master');
        await expect(peer1.groupRow).toContainText('Peer Two');
        await expect(peer2.groupRow).toContainText('Master');
        await expect(peer2.groupRow).toContainText('Peer One');

        const said = {
            master: `master says ${Date.now()}`,
            peer1: `peer one says ${Date.now()}`,
            peer2: `peer two says ${Date.now()}`,
        };
        await master.sendMessage(said.master);
        await expect(peer1.peerBubble(said.master)).toHaveCount(1);
        await expect(peer2.peerBubble(said.master)).toHaveCount(1);
        await peer1.sendMessage(said.peer1);
        await expect(master.peerBubble(said.peer1)).toHaveCount(1);
        await expect(peer2.peerBubble(said.peer1)).toHaveCount(1);
        await peer2.sendMessage(said.peer2);
        await expect(master.peerBubble(said.peer2)).toHaveCount(1);
        await expect(peer1.peerBubble(said.peer2)).toHaveCount(1);

        await expect(peer2.authorLine('Master')).toHaveCount(1);
        await expect(peer2.authorLine('Peer One')).toHaveCount(1);
        await expect(master.authorLine('Peer One')).toHaveCount(1);
        await expect(master.authorLine('Peer Two')).toHaveCount(1);

        const replies: Array<{ from: EphemonApp; to: string; text: string }> = [
            { from: master, to: said.peer1, text: `master to peer one ${Date.now()}` },
            { from: master, to: said.peer2, text: `master to peer two ${Date.now()}` },
            { from: peer1, to: said.master, text: `peer one to master ${Date.now()}` },
            { from: peer1, to: said.peer2, text: `peer one to peer two ${Date.now()}` },
            { from: peer2, to: said.master, text: `peer two to master ${Date.now()}` },
            { from: peer2, to: said.peer1, text: `peer two to peer one ${Date.now()}` },
        ];
        for (const reply of replies) {
            await reply.from.replyTo(reply.to);
            await reply.from.sendMessage(reply.text);
            await expect(reply.from.quoteOf(reply.from.ownBubble(reply.text))).toHaveCount(1);
            for (const app of everyone.filter((candidate) => candidate !== reply.from)) {
                await expect(app.peerBubble(reply.text)).toHaveCount(1);
                await expect(app.quoteOf(app.peerBubble(reply.text))).toHaveCount(1);
            }
        }

        const reactions: Array<{ from: EphemonApp; to: string; emoji: string }> = [
            { from: master, to: said.peer1, emoji: '👍' },
            { from: master, to: said.peer2, emoji: '🔥' },
            { from: peer1, to: said.master, emoji: '👍' },
            { from: peer1, to: said.peer2, emoji: '❤️' },
            { from: peer2, to: said.master, emoji: '🔥' },
            { from: peer2, to: said.peer1, emoji: '❤️' },
        ];
        for (const reaction of reactions) {
            await reaction.from.reactTo(reaction.to, reaction.emoji);
            await expect(reaction.from.reactionOn(reaction.to)).toHaveCount(1);
        }
        const settled: Array<{ author: EphemonApp; text: string; emojis: ReadonlyArray<string> }> = [
            { author: master, text: said.master, emojis: ['👍', '🔥'] },
            { author: peer1, text: said.peer1, emojis: ['👍', '❤️'] },
            { author: peer2, text: said.peer2, emojis: ['🔥', '❤️'] },
        ];
        for (const entry of settled) {
            for (const app of everyone) {
                const bubble = app === entry.author ? app.ownReactions(entry.text) : app.reactionOn(entry.text);
                await expect(bubble).toHaveCount(1);
                await expect(bubble).toHaveText(new RegExp(`(${entry.emojis.join('|')})\\s*\\+`));
            }
        }

        const restarts: Array<{ app: EphemonApp; password: string; text: string }> = [
            { app: master, password: PASSWORDS.master, text: `master after restart ${Date.now()}` },
            { app: peer1, password: PASSWORDS.peer1, text: `peer one after restart ${Date.now()}` },
            { app: peer2, password: PASSWORDS.peer2, text: `peer two after restart ${Date.now()}` },
        ];
        for (const restart of restarts) {
            await restart.app.page.reload({ waitUntil: 'domcontentloaded' });
            await restart.app.page.waitForSelector('.lock__card');
            await restart.app.unlock(restart.password);
            await restart.app.selectGroup();

            await restart.app.sendMessage(restart.text);
            await expect(restart.app.ownBubble(restart.text)).toHaveCount(1);
            if (await restart.app.retryBanner.isVisible()) {
                await restart.app.retryFromBanner();
            } else {
                await restart.app.reconnectFromKebab();
            }
            await restart.app.waitForConnected();
            for (const app of everyone.filter((candidate) => candidate !== restart.app)) {
                await app.scrollMessagesToBottom();
                await expect(app.peerBubble(restart.text)).toHaveCount(1);
            }
        }
    } finally {
        await master.close();
        await peer1.close();
        await peer2.close();
    }
});
