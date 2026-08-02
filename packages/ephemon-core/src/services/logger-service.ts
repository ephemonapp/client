export interface LoggerServiceConfig {
    onTrace?: (...args: any[]) => void;

    onDebug?: (...args: any[]) => void;

    onLog?: (...args: any[]) => void;

    onWarn?: (...args: any[]) => void;

    onError?: (...args: any[]) => void;
}

export type LoggerService = {
    initialize(config: LoggerServiceConfig): void;

    trace(...args: any[]): void;

    debug(...args: any[]): void;

    log(...args: any[]): void;

    warn(...args: any[]): void;

    error(...args: any[]): void;
};

export function getLoggerService(): LoggerService {
    let onTrace: ((...args: any[]) => void) | undefined;
    let onDebug: ((...args: any[]) => void) | undefined;
    let onLog: ((...args: any[]) => void) | undefined;
    let onWarn: ((...args: any[]) => void) | undefined;
    let onError: ((...args: any[]) => void) | undefined;
    return {
        initialize(config: LoggerServiceConfig) {
            onTrace = config.onTrace;
            onDebug = config.onDebug;
            onLog = config.onLog;
            onWarn = config.onWarn;
            onError = config.onError;
            this.debug('[logger-service] Initialized.');
        },
        trace(...args: any[]) {
            if (onTrace) {
                onTrace(...args);
            }
        },
        debug(...args: any[]) {
            if (onDebug) {
                onDebug(...args);
            }
        },
        log(...args: any[]) {
            if (onLog) {
                onLog(...args);
            }
        },
        warn(...args: any[]) {
            if (onWarn) {
                onWarn(...args);
            }
        },
        error(...args: any[]) {
            if (onError) {
                onError(...args);
            }
        },
    };
}
