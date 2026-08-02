import { expect, test } from '@playwright/test';

const IDLE_MS = 6000;
const APP = `/?__debug_password=hunter2&__debug_idle_ms=${IDLE_MS}&__debug_disable_push_service=true`;

test.describe('idle lock', () => {
    test('warns before locking and any activity cancels it', async ({ page }) => {
        await page.goto(APP);
        await expect(page.locator('.idle__timer')).toBeVisible({ timeout: 15_000 });

        const first = Number((await page.locator('.idle__timer').textContent())?.replace('s', ''));
        expect(first).toBeGreaterThan(0);
        expect(first).toBeLessThanOrEqual(IDLE_MS / 2000);

        await page.locator('.modal-primary').click();
        await expect(page.locator('.idle__timer')).toBeHidden();

        await expect(page.locator('.idle__timer')).toBeVisible({ timeout: 15_000 });
        await page.keyboard.press('a');
        await expect(page.locator('.idle__timer')).toBeHidden();
    });

    test('synthetic events do not count as activity', async ({ page }) => {
        await page.goto(APP);
        await expect(page.locator('.idle__timer')).toBeVisible({ timeout: 15_000 });

        await page.evaluate(() => {
            for (let i = 0; i < 20; i++) {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
                document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            }
        });

        await expect(page.locator('.idle__timer')).toBeVisible();
        await expect(page.locator('.lock__submit')).toBeVisible({ timeout: 15_000 });
    });

    test('locks the vault when the warning is ignored', async ({ page }) => {
        await page.goto(APP);
        await expect(page.locator('.idle__timer')).toBeVisible({ timeout: 15_000 });

        await expect(page.locator('.lock__submit')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.idle__timer')).toBeHidden();
    });
});
