import { LogEntryProps } from '../types/logEntryType';
import { now } from '../utils/functions';
import { Logger } from '../utils/logger';

const MAX_ENTRIES = 500;

const entries: LogEntryProps[] = [];
const listeners = new Set<() => void>();

let snapshot: ReadonlyArray<LogEntryProps> = entries.slice();

function publish(): void {
    snapshot = entries.slice();
    for (const listener of listeners) {
        listener();
    }
}

export function subscribeLogs(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getLogs(): ReadonlyArray<LogEntryProps> {
    return snapshot;
}

const LOG_LEVELS: App.LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];

function permits(threshold: App.LogLevel, level: App.LogLevel): boolean {
    return LOG_LEVELS.indexOf(threshold) <= LOG_LEVELS.indexOf(level);
}

function describe(value: unknown): string {
    if (value instanceof Error) return JSON.stringify(value, Object.getOwnPropertyNames(value));
    if (typeof value === 'object' && value !== null) return JSON.stringify(value);
    return String(value);
}

function createLogger(consoleLevel: App.LogLevel, documentLevel: App.LogLevel): Logger {
    const original = { ...console };

    function write(level: App.LogLevel, args: unknown[]): void {
        if (permits(consoleLevel, level)) {
            const method = level === 'info' ? 'log' : level;
            (original as unknown as Record<string, (...values: unknown[]) => void>)[method](...args);
        }
        if (permits(documentLevel, level)) {
            if (entries.length >= MAX_ENTRIES) entries.shift();
            entries.push({ timestamp: now(), level, content: args.map(describe).join(' ') });
            publish();
        }
    }

    return {
        trace: (...args: unknown[]) => write('trace', args),
        debug: (...args: unknown[]) => write('debug', args),
        log: (...args: unknown[]) => write('info', args),
        warn: (...args: unknown[]) => write('warn', args),
        error: (...args: unknown[]) => write('error', args),
    };
}

const logger = createLogger(
    process.env.EPHEMON_CONSOLE_LOG_LEVEL || 'info',
    process.env.EPHEMON_DOCUMENT_LOG_LEVEL || 'info',
);

console.log = logger.log;
console.error = logger.error;
console.warn = logger.warn;
console.debug = logger.debug;
console.trace = logger.trace;

export function getLogger(): Logger {
    return logger;
}
