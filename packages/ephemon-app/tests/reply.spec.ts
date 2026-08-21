import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

test('a quoted message keeps its author on both sides and resolves to the quoted event', async ({ browser }) => {
    const alice = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'alice');
    const bob = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'bob');
    try {
        await bob.unlock('reply-bob-pass');
        await alice.unlock('reply-alice-pass');
        await alice.connectTo(bob.publicKey, bob);
        await alice.waitForConnected();
        await bob.waitForConnected();

        const quoted = `quoted by its author ${Date.now()}`;
        await alice.sendMessage(quoted);
        await expect(bob.peerBubble(quoted)).toHaveCount(1, { timeout: 60_000 });

        const answer = `answer to the peer ${Date.now()}`;
        await bob.replyTo(quoted);
        await bob.sendMessage(answer);

        const bobAnswer = bob.ownBubble(answer);
        await expect(bob.quoteOf(bobAnswer)).toHaveClass(/bubble__reply--peer/);
        await expect(bob.quoteOf(bobAnswer)).toContainText(quoted);

        const aliceAnswer = alice.peerBubble(answer);
        await expect(aliceAnswer).toHaveCount(1, { timeout: 60_000 });
        await expect(alice.quoteOf(aliceAnswer)).toHaveClass(/bubble__reply--you/);
        await expect(alice.quoteOf(aliceAnswer)).toContainText(quoted);

        await alice.quoteOf(aliceAnswer).click();
        await expect(alice.markedBubble).toContainText(quoted);

        const own = `answer to my own message ${Date.now()}`;
        await alice.replyToOwn(quoted);
        await alice.sendMessage(own);

        const aliceOwn = alice.ownBubble(own);
        await expect(alice.quoteOf(aliceOwn)).toHaveClass(/bubble__reply--you/);
        await expect(alice.quoteOf(aliceOwn)).toContainText(quoted);

        const bobOwn = bob.peerBubble(own);
        await expect(bobOwn).toHaveCount(1, { timeout: 60_000 });
        await expect(bob.quoteOf(bobOwn)).toHaveClass(/bubble__reply--peer/);
        await expect(bob.quoteOf(bobOwn)).toContainText(quoted);
    } finally {
        await alice.close();
        await bob.close();
    }
});
