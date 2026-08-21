import { installNotificationRecorder } from './notificationRecorder';
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
        await page.addInitScript(installNotificationRecorder);

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

    async openSecondTab(origin: string, label: string): Promise<EphemonApp> {
        const page = await this.context.newPage();
        await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.lock__card', { timeout: 60_000 });
        return new EphemonApp(label, this.context, page);
    }

    async closeTab(): Promise<void> {
        await this.page.close();
    }

    async leaveApp(): Promise<void> {
        await this.page.goto('about:blank', { waitUntil: 'domcontentloaded' });
    }

    async returnToApp(origin: string, password: string): Promise<void> {
        await this.page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
        await this.page.waitForSelector('.lock__card', { timeout: 60_000 });
        await this.unlock(password);
    }

    get observerNotice(): Locator {
        return this.chat.locator('.chat__observer');
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
        await this.page.waitForSelector('html[data-public-key]', {
            timeout: 60_000,
        });
        const publicKey = await this.page.getAttribute('html', 'data-public-key');
        if (!publicKey) throw new Error(`[${this.label}] the core came up without a public key`);
        this._publicKey = publicKey;
    }

    async acceptIncomingDial(): Promise<void> {
        await this.page.waitForSelector('.dial__accept', { timeout: 60_000 });
        await this.page.click('.dial__accept');
    }

    async blockIncomingDial(): Promise<void> {
        await this.page.click('.dial__block');
    }

    notifications(): Promise<string[]> {
        return this.page.evaluate(() => window.__notifications ?? []);
    }

    get groupName(): Locator {
        return this.groupRow.locator('.conv-row__name');
    }

    get groupUnread(): Locator {
        return this.groupRow.locator('.conv-row__unread');
    }

    get blockedRows(): Locator {
        return this.page.locator('.modal-card .contact-picker__row');
    }

    async openBlockedFromSidebar(): Promise<void> {
        await this.page.click('.sidebar__blocked');
        await this.page.waitForSelector('.modal-card');
    }

    async unblockFromModal(): Promise<void> {
        await this.page.click('.blocked__unblock');
        await this.page.click('.blocked__unblock--confirm');
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
        return this.page.locator('.conv-row:not(.conv-row--group)').filter({ hasText: shortKey(publicKey) });
    }

    get groupRow(): Locator {
        return this.page.locator('.conv-row--group');
    }

    async selectGroup(): Promise<void> {
        await this.groupRow.first().click();
    }

    async createGroupFromSidebar(publicKeys: ReadonlyArray<string>, ownName: string): Promise<void> {
        await this.page.click('.sidebar__new-group');
        await this.page.waitForSelector('.contact-picker__list');
        await this.page.fill('.rename__input', ownName);
        for (const publicKey of publicKeys) {
            await this.page
                .locator('.contact-picker__row')
                .filter({ hasText: shortKey(publicKey) })
                .click();
        }
        await this.page.click('.contact-picker__confirm');
    }

    get disabledComposer(): Locator {
        return this.chat.locator('.composer--disabled');
    }

    get introduceForm(): Locator {
        return this.chat.locator('.introduce');
    }

    async nameSelfInGroup(name: string): Promise<void> {
        await this.page.waitForSelector('.introduce__input', { timeout: 60_000 });
        await this.page.fill('.introduce__input', name);
        await this.page.click('.introduce__save');
        await this.page.waitForSelector('.introduce__input', { state: 'detached', timeout: 60_000 });
    }

    async renameSelfInGroupFromKebab(name: string): Promise<void> {
        await this.kebabItem(/Change my name in group/);
        await this.page.waitForSelector('.rename__input');
        await this.page.fill('.rename__input', name);
        await this.page.click('.rename__save');
    }

    get retryBanner(): Locator {
        return this.chat.locator('.connecting--failed .connecting__retry');
    }

    async retryFromBanner(): Promise<void> {
        await this.retryBanner.click();
    }

    reactionOn(text: string): Locator {
        return this.peerBubble(text).locator('.bubble__reaction');
    }

    peerReactions(text: string): Locator {
        return this.peerBubble(text).locator('.bubble__reaction');
    }

    ownReactions(text: string): Locator {
        return this.ownBubble(text).locator('.bubble__reaction');
    }

    ownReactionOn(text: string): Locator {
        return this.ownBubble(text).locator('.bubble__reaction');
    }

    reactionMoreOn(text: string): Locator {
        return this.peerBubble(text).locator('.bubble__reaction-more');
    }

    async openReactionDetails(text: string): Promise<void> {
        await this.peerBubble(text).first().scrollIntoViewIfNeeded();
        await this.reactionMoreOn(text).first().click();
        await this.page.waitForSelector('.receipt-list');
    }

    get receiptRows(): Locator {
        return this.page.locator('.receipt-list__row');
    }

    receiptRowFor(name: string): Locator {
        return this.receiptRows.filter({ hasText: name });
    }

    async openReceiptList(text: string): Promise<void> {
        await this.ownBubble(text).first().scrollIntoViewIfNeeded();
        await this.ownBubble(text).locator('.bubble__receipt').first().click();
        await this.page.waitForSelector('.receipt-list');
    }

    async closeReceiptList(): Promise<void> {
        await this.page.click('.modal-close');
        await this.page.waitForSelector('.receipt-list', { state: 'detached' });
    }

    authorLine(text: string): Locator {
        return this.chat.locator('.bubble__author').filter({ hasText: text });
    }

    get markedBubble(): Locator {
        return this.chat.locator('.bubble--highlight');
    }

    peerBubble(text: string): Locator {
        return this.chat
            .locator('.bubble--peer')
            .filter({ has: this.page.locator('.bubble__text', { hasText: text }) });
    }

    ownBubble(text: string): Locator {
        return this.chat.locator('.bubble--you').filter({ has: this.page.locator('.bubble__text', { hasText: text }) });
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

    async connectTo(publicKey: string, peer?: EphemonApp): Promise<void> {
        await this.page.fill('.connect__paste input', publicKey);
        await this.page.click('.connect__paste .icon-btn');
        if (peer !== undefined) await peer.acceptIncomingDial();
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

    async addMemberFromKebab(publicKey: string): Promise<void> {
        await this.kebabItem(/Add member/);
        await this.page.waitForSelector('.contact-picker__list');
        await this.page
            .locator('.contact-picker__row')
            .filter({ hasText: shortKey(publicKey) })
            .click();
        await this.page.click('.contact-picker__confirm');
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
        if ((await this.peerBubble(text).count()) === 0) {
            for (let attempt = 0; attempt < 10 && (await this.peerBubble(text).count()) === 0; attempt += 1) {
                await this.scrollMessagesToTop();
                await this.page.waitForTimeout(150);
            }
        }
        await this.peerBubble(text).first().waitFor({ state: 'attached', timeout: 10_000 });
        await this.peerBubble(text).first().scrollIntoViewIfNeeded();
        await this.peerBubble(text).locator('.bubble__add, .bubble__reaction-value').first().click({ timeout: 15_000 });
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
        await this.peerBubble(text).locator('xpath=..').locator('.reply-btn').first().click();
        await this.page.waitForSelector('.reply-bar');
    }

    async replyToOwn(text: string): Promise<void> {
        await this.ownBubble(text).locator('xpath=..').locator('.reply-btn').click();
        await this.page.waitForSelector('.reply-bar');
    }

    quoteOf(bubble: Locator): Locator {
        return bubble.locator('.bubble__reply');
    }

    async jumpFromReplyBar(): Promise<void> {
        await this.chat.locator('.reply-bar').click();
    }

    async cancelReply(): Promise<void> {
        await this.chat.locator('.reply-bar__close').click();
    }
}
