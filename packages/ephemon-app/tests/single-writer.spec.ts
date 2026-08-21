import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

test('a second tab observes instead of writing, and is promoted when the first one goes away', async ({ browser }) => {
    const password = 'single-writer-pass';
    const first = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'first');
    let second: EphemonApp | undefined;
    try {
        await first.unlock(password);
        await first.connectTo(first.publicKey);
        await first.waitForConnected();

        const text = `written by the first tab ${Date.now()}`;
        await first.sendMessage(text);
        await expect(first.ownBubble(text)).toHaveCount(1);

        second = await first.openSecondTab(AUDIT_ORIGIN, 'second');
        await second.unlock(password);
        await second.selectConversation(first.publicKey);

        await expect(second.ownBubble(text)).toHaveCount(1, { timeout: 60_000 });
        await expect(second.observerNotice).toBeVisible();
        await expect(second.composer).toBeDisabled();
        await expect(second.disabledComposer).toHaveCount(1);
        await expect(first.observerNotice).toHaveCount(0);
        await expect(first.composer).toBeEnabled();

        const whileObserving = `written while the second tab observes ${Date.now()}`;
        await first.sendMessage(whileObserving);
        await expect(second.ownBubble(whileObserving)).toHaveCount(1, { timeout: 60_000 });

        await first.closeTab();
        await expect(second.observerNotice).toHaveCount(0, { timeout: 60_000 });
        await expect(second.composer).toBeEnabled();
        await expect(second.disabledComposer).toHaveCount(0);

        await expect(second.ownBubble(text)).toHaveCount(1);
        await expect(second.ownBubble(whileObserving)).toHaveCount(1);

        const afterPromotion = `written after promotion ${Date.now()}`;
        await second.sendMessage(afterPromotion);
        await expect(second.ownBubble(afterPromotion)).toHaveCount(1);
    } finally {
        await second?.close();
    }
});
