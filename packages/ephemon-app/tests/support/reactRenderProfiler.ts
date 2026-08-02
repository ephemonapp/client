import type { Page } from '@playwright/test';

export type RenderLabel = string;

export type RenderReport = {
    commits: RenderLabel[][];
    byComponent: Record<string, number>;
    byInstance: Record<RenderLabel, number>;
    total: number;
};

declare global {
    interface Window {
        __reactRenderProfiler?: {
            reset(): void;
            commits(): RenderLabel[][];
            commitCount(): number;
            renderers(): number;
            errors(): string[];
        };
    }
}

export function installReactRenderProfiler(): void {
    const PERFORMED_WORK = 0b1;

    type Fiber = {
        type: unknown;
        key: string | null;
        flags: number;
        child: Fiber | null;
        sibling: Fiber | null;
        alternate: Fiber | null;
    };

    const commits: string[][] = [];
    const errors: string[] = [];
    let rendererCount = 0;
    let current: string[] = [];

    function displayNameOf(type: unknown): string | null {
        if (type === null || type === undefined) return null;
        if (typeof type === 'function') {
            const fn = type as { displayName?: string; name?: string };
            return fn.displayName || fn.name || null;
        }
        if (typeof type === 'object') {
            const wrapper = type as { displayName?: string; type?: unknown; render?: unknown };
            if (typeof wrapper.displayName === 'string') return wrapper.displayName;
            if (wrapper.type !== undefined) return displayNameOf(wrapper.type);
            if (wrapper.render !== undefined) return displayNameOf(wrapper.render);
        }
        return null;
    }

    function record(fiber: Fiber): void {
        const name = displayNameOf(fiber.type);
        if (name === null) return;
        current.push(fiber.key === null ? name : name + '#' + fiber.key);
    }

    function walkMounted(fiber: Fiber | null): void {
        if (fiber === null) return;
        record(fiber);
        let child = fiber.child;
        while (child !== null) {
            walkMounted(child);
            child = child.sibling;
        }
    }

    function walkUpdated(next: Fiber, prev: Fiber): void {
        if ((next.flags & PERFORMED_WORK) !== 0) record(next);
        if (next.child === prev.child) return;
        let child = next.child;
        while (child !== null) {
            const before = child.alternate;
            if (before === null) walkMounted(child);
            else walkUpdated(child, before);
            child = child.sibling;
        }
    }

    function onCommit(root: { current: Fiber }): void {
        current = [];
        const next = root.current;
        const prev = next.alternate;
        if (prev === null) walkMounted(next);
        else walkUpdated(next, prev);
        commits.push(current);
        current = [];
    }

    const hook = {
        renderers: new Map<number, unknown>(),
        supportsFiber: true,
        isDisabled: false,
        inject(renderer: unknown): number {
            rendererCount += 1;
            this.renderers.set(rendererCount, renderer);
            return rendererCount;
        },
        onCommitFiberRoot(_id: number, root: { current: Fiber }): void {
            try {
                onCommit(root);
            } catch (error) {
                errors.push(String(error));
            }
        },
        onPostCommitFiberRoot(): void {},
        onCommitFiberUnmount(): void {},
        checkDCE(): void {},
        getFiberRoots(): Set<unknown> {
            return new Set();
        },
        setStrictMode(): void {},
        registerInternalModuleStart(): void {},
        registerInternalModuleStop(): void {},
        getInternalModuleRanges(): unknown[] {
            return [];
        },
        on(): void {},
        off(): void {},
        emit(): void {},
        sub(): () => void {
            return () => {};
        },
    };

    Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: hook, configurable: true });

    window.__reactRenderProfiler = {
        reset: () => {
            commits.length = 0;
            errors.length = 0;
        },
        commits: () => commits.map((commit) => commit.slice()),
        commitCount: () => commits.length,
        renderers: () => rendererCount,
        errors: () => errors.slice(),
    };
}

function summarise(commits: RenderLabel[][]): RenderReport {
    const byComponent: Record<string, number> = {};
    const byInstance: Record<string, number> = {};
    let total = 0;
    for (const commit of commits) {
        for (const label of commit) {
            const component = label.split('#')[0];
            byComponent[component] = (byComponent[component] ?? 0) + 1;
            byInstance[label] = (byInstance[label] ?? 0) + 1;
            total += 1;
        }
    }
    return { commits, byComponent, byInstance, total };
}

export async function assertProfilerAttached(page: Page): Promise<void> {
    const renderers = await page.evaluate(() => window.__reactRenderProfiler?.renderers() ?? -1);
    if (renderers < 1) {
        throw new Error(
            `React never injected into the profiler hook (renderers=${renderers}). ` +
                'The instrumentation must be installed before the app bundle runs.',
        );
    }
}

async function evaluateAcrossNavigation<T>(page: Page, fn: () => T, fallback: T): Promise<T> {
    try {
        return await page.evaluate(fn);
    } catch (error) {
        if (String(error).includes('Execution context was destroyed')) return fallback;
        throw error;
    }
}

async function waitForRenderQuiet(page: Page, quietMs: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let seen = -1;
    for (;;) {
        const count = await evaluateAcrossNavigation(page, () => window.__reactRenderProfiler?.commitCount() ?? 0, -1);
        if (count === seen) return;
        seen = count;
        if (Date.now() > deadline) return;
        await page.waitForTimeout(quietMs);
    }
}

export type MeasureOptions = {
    quietMs?: number;
    timeoutMs?: number;
};

export async function collectRenders(page: Page, options: MeasureOptions = {}): Promise<RenderReport> {
    const { quietMs = 250, timeoutMs = 15_000 } = options;
    await waitForRenderQuiet(page, quietMs, timeoutMs);
    const commits = await evaluateAcrossNavigation(page, () => window.__reactRenderProfiler?.commits() ?? [], []);
    const errors = await evaluateAcrossNavigation(page, () => window.__reactRenderProfiler?.errors() ?? [], []);
    if (errors.length > 0) {
        throw new Error(`Render profiler failed while walking the fiber tree: ${errors.join('; ')}`);
    }
    return summarise(commits);
}

export async function measureRenders(
    page: Page,
    action: () => Promise<void>,
    options: MeasureOptions = {},
): Promise<RenderReport> {
    const { quietMs = 250, timeoutMs = 15_000 } = options;
    await waitForRenderQuiet(page, quietMs, timeoutMs);
    await evaluateAcrossNavigation(page, () => void window.__reactRenderProfiler?.reset(), undefined);

    await action();

    return collectRenders(page, options);
}

export function formatReport(title: string, report: RenderReport): string {
    const rows = Object.entries(report.byInstance).sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
    const width = rows.reduce((max, [label]) => Math.max(max, label.length), 0);
    const lines = rows.map(([label, count]) => `  ${label.padEnd(width)}  ${count}`);
    return [`${title}: ${report.commits.length} commit(s), ${report.total} component render(s)`, ...lines].join('\n');
}
