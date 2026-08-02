import { installReactRenderProfiler } from './reactRenderProfiler';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';

function shortKey(key: string): string {
    return key.length > 16 ? `${key.slice(0, 7)}…${key.slice(-6)}` : key;
}

export class EphemonApp {
    private _publicKey = '';

    private constructor(
        readonly label: string,
        readonly context: BrowserContext,
        readonly page: Page,
    ) {}

    static async launch(browser: Browser, origin: string, label: string): Promise<EphemonApp> {
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        await context.grantPermissions(['notifications'], { origin });
        const page = await context.newPage();

        await page.addInitScript(installReactRenderProfiler);

        page.on('dialog', (dialog) => void dialog.accept());

        await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.lock__card', { timeout: 60_000 });

        return new EphemonApp(label, context, page);
    }

    get publicKey(): string {
        if (!this._publicKey) throw new Error(`[${this.label}] has no identity yet`);
        return this._publicKey;
    }

    async close(): Promise<void> {
        await this.context.close();
    }

    async openLockPrivacy(): Promise<void> {
        await this.page.click('.lock__links a[href="#privacy"]');
        await this.page.waitForSelector('.modal-card');
    }

    async resetDevice(): Promise<void> {
        await this.page.click('.lock__reset-link');
        await this.page.click('.lock__reset-erase');
        await this.page.waitForURL(/./, { waitUntil: 'domcontentloaded' });
        await this.page.waitForSelector('.lock__card', { timeout: 60_000 });
    }

    async typePassword(password: string): Promise<void> {
        await this.page.click('.lock__field input');
        for (const character of password) {
            await this.page.keyboard.press(character);
        }
    }

    async pressPasswordKey(character: string): Promise<void> {
        await this.page.keyboard.press(character);
    }

    async submitUnlock(): Promise<void> {
        await this.page.click('.lock__submit');
        void this.page
            .locator('.permission-overlay__btn')
            .click({ timeout: 5_000 })
            .catch(() => {});
        await this.page.waitForSelector('.messenger', { timeout: 60_000 });
        await this.page.waitForSelector('html[data-public-key]', { timeout: 60_000 });
        const publicKey = await this.page.getAttribute('html', 'data-public-key');
        if (!publicKey) throw new Error(`[${this.label}] the core came up without a public key`);
        this._publicKey = publicKey;
    }

    async unlock(password: string): Promise<void> {
        await this.typePassword(password);
        await this.submitUnlock();
    }

    async lock(): Promise<void> {
        await this.page.click('.brand .icon-btn--danger[title="Lock Ephemon"]');
        await this.page.waitForSelector('.lock__card', { timeout: 60_000 });
    }

    get chat(): Locator {
        return this.page.locator('.messenger__chat-area .chat:visible');
    }

    get composer(): Locator {
        return this.chat.locator('.composer input');
    }

    get rows(): Locator {
        return this.page.locator('.conv-row');
    }

    get bubbles(): Locator {
        return this.chat.locator('.bubble-row');
    }

    async scrollMessagesToTop(): Promise<void> {
        await this.chat.locator('.msg-list').evaluate((element) => {
            element.scrollTop = 0;
        });
    }

    async scrollMessagesToBottom(): Promise<void> {
        await this.chat.locator('.msg-list').evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });
    }

    rowFor(publicKey: string): Locator {
        return this.page.locator('.conv-row').filter({ hasText: shortKey(publicKey) });
    }

    get markedBubble(): Locator {
        return this.chat.locator('.bubble--highlight');
    }

    peerBubble(text: string): Locator {
        return this.chat.locator('.bubble--peer').filter({ hasText: text });
    }

    ownBubble(text: string): Locator {
        return this.chat.locator('.bubble--you').filter({ hasText: text });
    }

    async openMyQr(): Promise<void> {
        await this.page.click('.brand .icon-btn[title="Show my QR / copy code"]');
        await this.page.waitForSelector('.qr');
    }

    async openPrivacy(): Promise<void> {
        await this.page.click('.sidebar__footer');
        await this.page.waitForSelector('.modal-card');
    }

    async closeModal(): Promise<void> {
        await this.page.click('.modal-close');
        await this.page.waitForSelector('.modal-card', { state: 'detached' });
    }

    async toggleTheme(): Promise<void> {
        await this.page.click('.brand .icon-btn[title="Theme"]');
    }

    async connectTo(publicKey: string): Promise<void> {
        await this.page.fill('.connect__paste input', publicKey);
        await this.page.click('.connect__paste .icon-btn');
    }

    async waitForConnected(timeout = 90_000): Promise<void> {
        await this.page.waitForFunction(
            () =>
                [...document.querySelectorAll('.chat-header__status')].some((node) =>
                    node.textContent?.includes('connected'),
                ),
            undefined,
            { timeout },
        );
    }

    async selectConversation(publicKey: string): Promise<void> {
        await this.rowFor(publicKey).click();
    }

    async openKebab(): Promise<void> {
        await this.chat.locator('.chat-header .icon-btn[title="More"]').click();
        await this.chat.locator('.kebab').waitFor();
    }

    async closeKebab(): Promise<void> {
        await this.chat.locator('.kebab-overlay').click({ position: { x: 4, y: 4 } });
        await this.chat.locator('.kebab').waitFor({ state: 'detached' });
    }

    private async kebabItem(label: string | RegExp): Promise<void> {
        await this.openKebab();
        await this.chat.locator('.kebab__item').filter({ hasText: label }).click();
    }

    async reconnectFromKebab(): Promise<void> {
        await this.kebabItem(/Reconnect|Connect/);
    }

    async showPeerQrFromKebab(): Promise<void> {
        await this.kebabItem(/QR code/);
        await this.page.waitForSelector('.qr');
    }

    async clearHistoryFromKebab(): Promise<void> {
        await this.kebabItem(/Clear history/);
    }

    async deleteChatFromKebab(): Promise<void> {
        await this.kebabItem(/Delete chat/);
    }

    async openRenameFromKebab(): Promise<void> {
        await this.kebabItem(/Rename contact/);
        await this.page.waitForSelector('.rename__input');
        await this.page.fill('.rename__input', '');
    }

    async pressRenameKey(character: string): Promise<void> {
        await this.page.locator('.rename__input').press(character);
    }

    async saveRename(): Promise<void> {
        await this.page.click('.rename__save');
        await this.page.waitForSelector('.rename__input', { state: 'detached' });
    }

    async typeAndSend(text: string): Promise<void> {
        await this.composer.click();
        for (const character of text) {
            await this.composer.press(character);
        }
        await this.composer.press('Enter');
    }

    async sendMessage(text: string): Promise<void> {
        await this.composer.fill(text);
        await this.composer.press('Enter');
    }

    async typeCharacter(character: string): Promise<void> {
        await this.composer.press(character);
    }

    async clearComposer(): Promise<void> {
        await this.composer.fill('');
    }

    async openReactionPicker(text: string): Promise<void> {
        await this.peerBubble(text).locator('.bubble__add, .bubble__reaction').first().click();
        await this.page.waitForSelector('.reaction-picker');
    }

    async closeReactionPicker(): Promise<void> {
        await this.page.locator('.reaction-picker-overlay').click({ position: { x: 4, y: 4 } });
        await this.page.waitForSelector('.reaction-picker', { state: 'detached' });
    }

    async reactTo(text: string, emoji: string): Promise<void> {
        await this.openReactionPicker(text);
        await this.page.locator('.reaction-picker button', { hasText: emoji }).first().click();
    }

    async replyTo(text: string): Promise<void> {
        await this.peerBubble(text).locator('xpath=..').locator('.reply-btn').click();
        await this.page.waitForSelector('.reply-bar');
    }

    async jumpFromReplyBar(): Promise<void> {
        await this.chat.locator('.reply-bar').click();
    }

    async cancelReply(): Promise<void> {
        await this.chat.locator('.reply-bar__close').click();
    }
}
