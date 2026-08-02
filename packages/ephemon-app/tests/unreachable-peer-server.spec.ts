import { encodeContact } from '../../ephemon-core/src/utils/contact';
import { expect, Page, test } from '@playwright/test';

const PEER_PUBLIC_KEY = 'a1B2c3D4e5F6g7H8i9J0kLmNoPqRsTuVwXyZ0123454=';
const PASSWORD = 'playwright-unreachable';

const INSECURE_SERVER = 'http://127.0.0.1:5999';
const OFFLINE_SERVER = 'https://offline.ephemon.test';
const PRIVATE_SERVER = 'https://private.ephemon.test';

async function unlock(page: Page): Promise<void> {
    await page.goto('/?__debug_disable_push_service=true');
    await page.waitForSelector('.lock__submit');
    await page.locator('#root .lock__field input').fill(PASSWORD);
    await page.locator('#root .lock__submit').click();
    await expect(page.locator('.connect__paste input')).toBeVisible();
}

async function connectTo(page: Page, serverUrl: string): Promise<void> {
    await page.locator('.connect__paste input').fill(encodeContact(PEER_PUBLIC_KEY, serverUrl));
    await page.locator('.connect__paste .icon-btn').click();
}

test.describe('a peer whose server will not take us', () => {
    test.beforeEach(async ({ page }) => {
        await page.route(/\/(signal|api)\/v1\//, (route) => route.abort());
        await unlock(page);
    });

    test('names the server it could not reach instead of spinning forever', async ({ page }) => {
        await page.route(`${OFFLINE_SERVER}/health`, (route) => route.abort());
        await connectTo(page, OFFLINE_SERVER);

        const failure = page.locator('.connecting--failed');
        await expect(failure).toBeVisible({ timeout: 60_000 });
        await expect(failure).toContainText(`${OFFLINE_SERVER} did not answer`);
        await expect(failure.locator('.connecting__retry')).toBeVisible();

        await expect(page.locator('.chat-header__status')).toContainText('server is down');
        await expect(page.locator('.conv-row__status')).toContainText('server is down');
        await expect(page.locator('.connecting__label', { hasText: 'Connecting' })).toHaveCount(0);
    });

    test('tells a server that refuses this app from one that is down', async ({ page }) => {
        await page.route(`${PRIVATE_SERVER}/health`, (route) => route.fulfill({ status: 200, body: 'ok' }));
        await connectTo(page, PRIVATE_SERVER);

        const failure = page.locator('.connecting--failed');
        await expect(failure).toBeVisible({ timeout: 60_000 });
        await expect(failure).toContainText(`${PRIVATE_SERVER} refuses connections from this app`);
        await expect(page.locator('.chat-header__status')).toContainText('server refuses this app');
    });

    test('calls out a server the browser will not let an https page talk to', async ({ page }) => {
        await connectTo(page, INSECURE_SERVER);

        const failure = page.locator('.connecting--failed');
        await expect(failure).toBeVisible({ timeout: 60_000 });
        await expect(failure).toContainText(`${INSECURE_SERVER} is served over http`);
        await expect(page.locator('.chat-header__status')).toContainText('needs https');
    });

    test('drops the reason as soon as a new attempt starts', async ({ page }) => {
        await page.route(`${OFFLINE_SERVER}/health`, (route) => route.abort());
        await connectTo(page, OFFLINE_SERVER);
        await expect(page.locator('.connecting--failed')).toBeVisible({ timeout: 60_000 });

        await page.locator('.connecting__retry').click();

        await expect(page.locator('.connecting--failed')).toHaveCount(0);
        await expect(page.locator('.chat-header__status')).not.toContainText('server is down');
    });

    test('remembers the server the contact pointed at across a reload', async ({ page }) => {
        await connectTo(page, INSECURE_SERVER);
        await expect(page.locator('.chat-header__name')).toBeVisible();

        await unlock(page);
        await page.locator('.conv-row').first().click();
        await page.locator('.chat-header__status').waitFor();
        await page.locator('.chat-header .icon-btn').click();
        await page.getByText("Show contact's QR code").click();

        await expect(page.locator('.qr__key')).toHaveText(encodeContact(PEER_PUBLIC_KEY, INSECURE_SERVER));
    });
});
