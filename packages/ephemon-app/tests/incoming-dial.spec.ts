import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import { expect, test } from '@playwright/test';

test('a dial that arrives while the tab is in the background asks for attention, and declining forever reads as such', async ({
    browser,
}) => {
    const alice = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'alice');
    const bob = await EphemonApp.launch(browser, AUDIT_ORIGIN, 'bob');
    try {
        await bob.unlock('dial-bob-pass');
        await alice.unlock('dial-alice-pass');

        // A background tab keeps reporting itself visible and focused under the test runner, so the state the app
        // reads is set directly.
        await bob.page.evaluate(() => {
            Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true });
        });

        await alice.connectTo(bob.publicKey);
        await expect.poll(() => bob.notifications()).toContain('Incoming connection');

        await bob.page.waitForSelector('.dial__block');
        const decline = bob.page.locator('.dial__block');
        const [background, accent] = await bob.page.evaluate(() => {
            const probe = document.createElement('div');
            probe.style.background = 'var(--unread)';
            document.body.appendChild(probe);
            const expected = getComputedStyle(probe).backgroundColor;
            probe.remove();
            const button = document.querySelector('.dial__block') as HTMLElement;
            return [getComputedStyle(button).backgroundColor, expected];
        });
        expect(background).toBe(accent);
        await expect(decline).toBeVisible();

        await bob.acceptIncomingDial();
        await alice.waitForConnected();
        await bob.waitForConnected();
    } finally {
        await alice.close();
        await bob.close();
    }
});
