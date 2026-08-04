import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

test('self chat replays an undelivered message after retry without MLS', async ({ browser }) => {
    const app = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'self');
    const errors: Array<string> = [];
    app.page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    try {
        const password = 'self-chat-pass';
        await app.unlock(password);
        await app.connectTo(app.publicKey);
        await app.waitForConnected();

        await app.page.reload({ waitUntil: 'domcontentloaded' });
        await app.page.waitForSelector('.lock__card', { timeout: 60_000 });
        await app.unlock(password);
        await app.selectConversation(app.publicKey);

        const text = `offline self message ${Date.now()}`;
        await app.sendMessage(text);
        const own = app.ownBubble(text);
        await expect(own).toHaveCount(1);
        await expect(own.locator('.bubble__retry')).toBeVisible({ timeout: 15_000 });

        await own.locator('.bubble__retry').click();
        await app.waitForConnected();
        await expect(own.locator('.bubble__retry')).toHaveCount(0);
        await expect(own.locator('.bubble__receipt')).toHaveAttribute('title', /^Delivered /);
        expect(errors.filter((error) => error !== '[push-service] Notification permission denied.')).toEqual([]);
    } finally {
        await app.close();
    }
});
