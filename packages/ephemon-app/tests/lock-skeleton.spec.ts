import { expect, test } from '@playwright/test';

const CARD_HEIGHT_TOLERANCE = 12;

type Box = { top: number; left: number; width: number; height: number };

async function box(page: import('@playwright/test').Page, selector: string): Promise<Box> {
    const handle = page.locator(selector).first();
    await handle.waitFor({ state: 'attached' });
    const rect = await handle.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return { top: r.top, left: r.left, width: r.width, height: r.height };
    });
    return rect;
}

test.describe('lock skeleton', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.lock__submit');
    });

    test('prerendered landing matches the rendered one exactly', async ({ page }) => {
        for (const part of ['.lock__landing', '.lock__headline', '.lock__features', '.lock__landing-footer']) {
            const skeleton = await box(page, `#lock-skeleton ${part}`);
            const rendered = await box(page, `#root ${part}`);
            expect(skeleton, `${part} drifted from the prerendered markup`).toEqual(rendered);
        }
    });

    test('form skeleton stands in for the real form', async ({ page }) => {
        const skeleton = await box(page, '#lock-skeleton .lock__card');
        const rendered = await box(page, '#root .lock__card');
        expect(
            Math.abs(skeleton.height - rendered.height),
            `lock form changed height (skeleton ${skeleton.height}, real ${rendered.height}) — update LockFormSkeleton`,
        ).toBeLessThanOrEqual(CARD_HEIGHT_TOLERANCE);
    });

    for (const [stored, system] of [
        ['light', 'dark'],
        ['dark', 'light'],
    ] as const) {
        test(`skeleton uses the stored ${stored} theme while the system is ${system}`, async ({ page }) => {
            await page.emulateMedia({ colorScheme: system });
            await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
                'ephemon_theme',
                stored,
            ] as const);

            await page.goto('/');
            await page.waitForSelector('.lock__submit');
            const mounted = await page
                .locator('#root .lock__form')
                .evaluate((element) => getComputedStyle(element).backgroundColor);

            await page.route('**/app.min.js*', (route) => route.abort());
            await page.goto('/');
            await page.waitForSelector('#lock-skeleton .lock__form');

            expect(await page.getAttribute('html', 'data-theme'), 'theme must resolve before any script').toBe(stored);
            const beforeScripts = await page
                .locator('#lock-skeleton .lock__form')
                .evaluate((element) => getComputedStyle(element).backgroundColor);
            expect(beforeScripts, `skeleton flashed the ${system} system theme instead of the stored one`).toBe(
                mounted,
            );
        });
    }

    test('skeleton is inert once react has mounted', async ({ page }) => {
        const skeleton = page.locator('#lock-skeleton');
        await expect(skeleton).toHaveAttribute('data-done', '');
        await expect(skeleton).toHaveAttribute('aria-hidden', 'true');
        expect(await skeleton.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none');
        expect(await skeleton.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
        expect(await page.locator('#lock-skeleton input, #lock-skeleton a, #lock-skeleton button').count()).toBe(0);
    });
});
