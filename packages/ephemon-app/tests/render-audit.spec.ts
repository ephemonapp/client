import { AUDIT_ORIGIN } from '../playwright.config';
import { EphemonApp } from './support/ephemonApp';
import {
    assertProfilerAttached,
    collectRenders,
    formatReport,
    measureRenders,
    type MeasureOptions,
    type RenderReport,
} from './support/reactRenderProfiler';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const PASSWORD = 'audit-pass';
const BULK_MESSAGES = 80;
const MAX_MOUNTED = 30;

type Budget = {
    renders?: number;
    forbidden?: string[];
    max?: Record<string, number>;
    maxInstances?: Record<string, number>;
};

const SHELL = ['App', 'Messenger', 'Sidebar', 'BrandHeader', 'ThemeProvider'];
const CONVERSATION = ['ChatPane', 'MessageList', 'MessageBubble', 'ConversationRow'];

const BUDGETS: Record<string, Budget> = {
    'cold boot to lock screen': { max: { App: 2, ThemeProvider: 2, LockScreen: 3, LockLanding: 1, Logo: 2 } },
    'open privacy (locked)': { renders: 8, forbidden: ['App', 'ThemeProvider', 'LockLanding', 'LockPasswordForm'] },
    'close privacy (locked)': { renders: 4, forbidden: ['App', 'ThemeProvider', 'LockLanding', 'LockPasswordForm'] },
    'reset device': { max: { App: 3, ThemeProvider: 3, LockScreen: 4, LockLanding: 1 } },
    'password keystroke': { renders: 2, forbidden: ['App', 'ThemeProvider', 'LockScreen', 'LockLanding', 'Logo'] },
    'unlock to messenger': { max: { App: 8, Messenger: 6, Sidebar: 4, ConversationList: 4 } },

    'view own key': { renders: 8, forbidden: CONVERSATION },
    'close own key': { renders: 4, forbidden: CONVERSATION },
    'open privacy (unlocked)': { renders: 8, forbidden: CONVERSATION },
    'close privacy (unlocked)': { renders: 4, forbidden: CONVERSATION },

    'connect to peer': { max: { App: 4, Messenger: 4, Sidebar: 2, BrandHeader: 0 } },
    'reconnect to peer': { max: { App: 4, Messenger: 4, Sidebar: 2, BrandHeader: 0 } },
    'reconnect from kebab': { max: { App: 2, Messenger: 1, Sidebar: 1, MessageBubble: 4 } },
    'peer QR from kebab': { renders: 16, forbidden: ['MessageList', 'MessageBubble'] },
    'rename keystroke': { renders: 2, forbidden: [...SHELL, 'ChatPane', 'MessageList', 'MessageBubble'] },
    'save rename': { renders: 14, forbidden: ['MessageList', 'MessageBubble'] },
    'clear history': { renders: 12, forbidden: ['App', 'Sidebar', 'BrandHeader'] },
    'delete chat': { renders: 20, max: { App: 2 } },

    'composer keystroke': {
        renders: 2,
        forbidden: [...SHELL, 'ChatPane', 'ChatHeader', 'MessageList', 'MessageBubble'],
    },
    'send a message': { renders: 36, forbidden: [...SHELL, 'ChatPane'], max: { MessageList: 2 } },
    'peer message arrives': { renders: 16, forbidden: [...SHELL, 'ChatPane'], max: { MessageList: 2 } },
    'react to a peer message': { renders: 10, forbidden: [...SHELL, 'MessageList'], max: { ChatPane: 2 } },
    [`send ${BULK_MESSAGES} messages`]: {
        renders: 22 * BULK_MESSAGES,
        forbidden: ['App', 'Messenger', 'Sidebar', 'BrandHeader', 'ChatPane'],
        max: { MessageList: 2 * BULK_MESSAGES },
    },

    'lock the app': { max: { App: 3, LockScreen: 3 } },
    'unlock again': {
        max: { App: 8, Messenger: 6, Sidebar: 4 },
        forbidden: ['MessageList', 'MessageBubble', 'ChatHeader', 'Composer'],
    },
    'select restored conversation': {
        renders: 140,
        forbidden: SHELL,
        max: { MessageList: 2 },
        maxInstances: { MessageBubble: MAX_MOUNTED },
    },
    'scroll back through history': {
        renders: 100,
        forbidden: [...SHELL, 'ChatPane', 'ChatHeader', 'Composer'],
        max: { MessageList: 2 },
    },
    'jump to a quoted message': {
        renders: 100,
        forbidden: [...SHELL, 'ChatPane', 'ChatHeader', 'Composer', 'ReplyBar'],
        max: { MessageList: 1 },
        maxInstances: { MessageBubble: MAX_MOUNTED },
    },
    'jump to a message already on screen': {
        renders: 6,
        forbidden: [...SHELL, 'ChatPane', 'ChatHeader', 'Composer', 'ReplyBar', 'MessageList'],
        maxInstances: { MessageBubble: 1 },
    },
    'send while disconnected, then reconnect': {
        renders: 180,
        forbidden: [...SHELL, 'ChatPane'],
        max: { MessageList: 4, ConversationRow: 6, ChatHeader: 6 },
        maxInstances: { MessageBubble: MAX_MOUNTED },
    },
};

const collected: string[] = [];
const sessionTotals: Record<string, number> = {};

async function record(testInfo: TestInfo, name: string, report: RenderReport): Promise<void> {
    for (const [component, count] of Object.entries(report.byComponent)) {
        sessionTotals[component] = (sessionTotals[component] ?? 0) + count;
    }
    const formatted = formatReport(name, report);
    progress(`${name}: ${report.total} render(s) in ${report.commits.length} commit(s)`);
    collected.push(formatted);
    await testInfo.attach(`renders -- ${name}`, { body: formatted, contentType: 'text/plain' });

    expect
        .soft(report.commits.length, `"${name}" recorded no commits -- the step is not measuring what it claims`)
        .toBeGreaterThan(0);

    const budget = BUDGETS[name];
    if (!budget) return;
    if (budget.renders !== undefined) {
        expect
            .soft(report.total, `"${name}" exceeded its render budget\n${formatted}`)
            .toBeLessThanOrEqual(budget.renders);
    }
    for (const component of budget.forbidden ?? []) {
        expect
            .soft(report.byComponent[component] ?? 0, `"${name}" must not re-render ${component}\n${formatted}`)
            .toBe(0);
    }
    for (const [component, ceiling] of Object.entries(budget.max ?? {})) {
        expect
            .soft(report.byComponent[component] ?? 0, `"${name}" rendered ${component} too often\n${formatted}`)
            .toBeLessThanOrEqual(ceiling);
    }
    for (const [component, ceiling] of Object.entries(budget.maxInstances ?? {})) {
        const instances = Object.keys(report.byInstance).filter((label) => label.startsWith(`${component}#`)).length;
        expect
            .soft(instances, `"${name}" rendered too many distinct ${component} instances\n${formatted}`)
            .toBeLessThanOrEqual(ceiling);
    }
}

async function auditStep(
    testInfo: TestInfo,
    page: Page,
    name: string,
    action: () => Promise<void>,
    options?: MeasureOptions,
): Promise<void> {
    await test.step(name, async () => {
        await record(testInfo, name, await measureRenders(page, action, options));
    });
}

const PROGRESS_LOG = resolve(process.cwd(), 'test-results', 'render-audit.progress.log');

function progress(message: string): void {
    const line = `[audit +${Math.round(process.uptime())}s] ${message}\n`;
    process.stdout.write(line);
    try {
        mkdirSync(dirname(PROGRESS_LOG), { recursive: true });
        appendFileSync(PROGRESS_LOG, line, 'utf8');
    } catch {}
}

async function onboard(app: EphemonApp, measured: { testInfo: TestInfo } | null): Promise<void> {
    const step = async (name: string, action: () => Promise<void>) => {
        if (measured) await auditStep(measured.testInfo, app.page, name, action);
        else await action();
    };

    if (measured) await record(measured.testInfo, 'cold boot to lock screen', await collectRenders(app.page));

    await step('open privacy (locked)', () => app.openLockPrivacy());
    await step('close privacy (locked)', () => app.closeModal());
    await step('reset device', () => app.resetDevice());

    await app.page.click('.lock__field input');
    await app.pressPasswordKey('a');
    await step('password keystroke', () => app.pressPasswordKey('b'));
    await app.page.fill('.lock__field input', '');

    await step('unlock to messenger', () => app.unlock(PASSWORD));
    progress(`${app.label} signed in`);
}

test('render audit', async ({ browser }, testInfo) => {
    writeFileSync(PROGRESS_LOG, '');
    progress('loading both participants...');

    const [alice, bob] = await Promise.all([
        EphemonApp.launch(browser, AUDIT_ORIGIN, 'alice'),
        EphemonApp.launch(browser, AUDIT_ORIGIN, 'bob'),
    ]);

    try {
        await assertProfilerAttached(alice.page);

        await onboard(bob, null);
        await onboard(alice, { testInfo });

        await auditStep(testInfo, alice.page, 'view own key', () => alice.openMyQr());
        await auditStep(testInfo, alice.page, 'close own key', () => alice.closeModal());
        await auditStep(testInfo, alice.page, 'open privacy (unlocked)', () => alice.openPrivacy());
        await auditStep(testInfo, alice.page, 'close privacy (unlocked)', () => alice.closeModal());

        progress('dialling alice -> bob...');
        await auditStep(testInfo, alice.page, 'connect to peer', async () => {
            await alice.connectTo(bob.publicKey, bob);
            await alice.waitForConnected();
        });
        await bob.waitForConnected();

        await auditStep(testInfo, alice.page, 'reconnect from kebab', async () => {
            await alice.reconnectFromKebab();
            await alice.waitForConnected();
        });

        await auditStep(testInfo, alice.page, 'peer QR from kebab', () => alice.showPeerQrFromKebab());
        await alice.closeModal();

        await alice.openRenameFromKebab();
        await alice.pressRenameKey('N');
        await auditStep(testInfo, alice.page, 'rename keystroke', () => alice.pressRenameKey('a'));
        await alice.pressRenameKey('m');
        await alice.pressRenameKey('e');
        await auditStep(testInfo, alice.page, 'save rename', () => alice.saveRename());
        await expect(alice.rows.filter({ hasText: 'Name' })).toHaveCount(1);

        await alice.sendMessage('to-be-cleared');
        await expect(alice.ownBubble('to-be-cleared')).toBeVisible();
        await auditStep(testInfo, alice.page, 'clear history', () => alice.clearHistoryFromKebab());

        await auditStep(testInfo, alice.page, 'delete chat', async () => {
            await alice.deleteChatFromKebab();
            await expect(alice.rows).toHaveCount(0);
        });

        progress('re-dialling alice -> bob...');
        await auditStep(testInfo, alice.page, 'reconnect to peer', async () => {
            await alice.connectTo(bob.publicKey, bob);
            await alice.waitForConnected();
        });
        await bob.waitForConnected();

        await alice.composer.click();
        await alice.typeCharacter('h');
        await auditStep(testInfo, alice.page, 'composer keystroke', () => alice.typeCharacter('i'));
        await alice.clearComposer();

        await auditStep(testInfo, alice.page, 'send a message', async () => {
            await alice.typeAndSend('audit-outgoing');
            await expect(alice.ownBubble('audit-outgoing')).toBeVisible();
        });

        await auditStep(testInfo, alice.page, 'peer message arrives', async () => {
            await bob.sendMessage('audit-incoming');
            await expect(alice.peerBubble('audit-incoming')).toBeVisible();
        });

        await auditStep(testInfo, alice.page, 'react to a peer message', async () => {
            await alice.reactTo('audit-incoming', '👍');
            await expect(alice.peerBubble('audit-incoming').locator('.bubble__reaction')).toBeVisible();
        });

        progress(`sending ${BULK_MESSAGES} messages...`);
        await auditStep(testInfo, alice.page, `send ${BULK_MESSAGES} messages`, async () => {
            for (let index = 0; index < BULK_MESSAGES; index += 1) {
                await alice.sendMessage(`bulk-${index}`);
            }
            await expect(alice.ownBubble(`bulk-${BULK_MESSAGES - 1}`)).toBeVisible();
        });

        await auditStep(testInfo, alice.page, 'lock the app', () => alice.lock());
        await auditStep(testInfo, alice.page, 'unlock again', () => alice.unlock(PASSWORD));

        await auditStep(testInfo, alice.page, 'select restored conversation', async () => {
            await alice.selectConversation(bob.publicKey);
            await expect(alice.chat).toBeVisible();
        });

        const mounted = await alice.bubbles.count();
        expect(mounted, 'a long conversation must not be materialised in full').toBeLessThanOrEqual(MAX_MOUNTED);
        await expect(alice.ownBubble(`bulk-${BULK_MESSAGES - 1}`)).toBeVisible();

        await auditStep(testInfo, alice.page, 'scroll back through history', async () => {
            await alice.scrollMessagesToTop();
            await expect(alice.ownBubble('bulk-0')).toBeVisible();
        });
        expect(await alice.bubbles.count(), 'scrolling back must unload what it scrolled past').toBeLessThanOrEqual(
            MAX_MOUNTED,
        );
        await expect(alice.ownBubble(`bulk-${BULK_MESSAGES - 1}`)).toHaveCount(0);

        await alice.replyTo('audit-incoming');

        await alice.scrollMessagesToBottom();
        await expect(alice.ownBubble(`bulk-${BULK_MESSAGES - 1}`)).toBeVisible();
        await expect(alice.peerBubble('audit-incoming')).toHaveCount(0);

        await auditStep(testInfo, alice.page, 'jump to a quoted message', async () => {
            await alice.jumpFromReplyBar();
            await expect(alice.peerBubble('audit-incoming')).toBeVisible();
            await expect(alice.markedBubble).toHaveCount(1);
            await expect(alice.markedBubble).toHaveCount(0);
        });

        await auditStep(testInfo, alice.page, 'jump to a message already on screen', async () => {
            await alice.jumpFromReplyBar();
            await expect(alice.markedBubble).toHaveCount(1);
            await expect(alice.markedBubble).toHaveCount(0);
        });

        await alice.cancelReply();
        await alice.scrollMessagesToBottom();
        await expect(alice.ownBubble(`bulk-${BULK_MESSAGES - 1}`)).toBeVisible();

        progress('sending while disconnected, then reconnecting...');
        await auditStep(
            testInfo,
            alice.page,
            'send while disconnected, then reconnect',
            async () => {
                await alice.typeAndSend('after-lock');
                await expect(alice.ownBubble('after-lock')).toBeVisible();
                await alice.reconnectFromKebab();
                await alice.waitForConnected(120_000);
                await expect(alice.ownBubble('after-lock').locator('.bubble__receipt')).toHaveAttribute(
                    'title',
                    /Delivered/,
                );
            },
            { quietMs: 500, timeoutMs: 120_000 },
        );
    } finally {
        const rows = Object.entries(sessionTotals).sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
        const width = rows.reduce((max, [name]) => Math.max(max, name.length), 0);
        const grandTotal = rows.reduce((sum, [, count]) => sum + count, 0);
        const summary = [
            `WHOLE WALKTHROUGH: ${grandTotal} component render(s)`,
            ...rows.map(([name, count]) => `  ${name.padEnd(width)}  ${count}`),
        ].join('\n');

        const path = resolve(testInfo.project.outputDir, 'render-audit.txt');
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, `${collected.join('\n\n')}\n\n${summary}\n`, 'utf8');
        appendFileSync(PROGRESS_LOG, `\n${summary}\n\nfull report: ${path}\n`, 'utf8');
        await testInfo.attach('renders -- whole walkthrough', { body: summary, contentType: 'text/plain' });
        await Promise.all([alice?.close(), bob?.close()]);
    }
});
