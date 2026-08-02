export interface Logger {
    trace(...args: any[]): void;

    debug(...args: any[]): void;

    log(...args: any[]): void;

    warn(...args: any[]): void;

    error(...args: any[]): void;
}
