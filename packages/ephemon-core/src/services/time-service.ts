import { Logger } from '../utils/logger';

export interface TimeService {
    get serverTime(): number;

    /** Every assignment is reported to the listeners registered via onSync. */
    set serverTime(value: number);

    /** If a synchronization has already happened, the listener is invoked immediately with the most recent timestamp so late subscribers are not left uninformed. */
    onSync(listener: (timestamp: number) => void): void;
}

export function getTimeService(logger: Logger): TimeService {
    let serverTimeDelta = 0;
    let lastSync: number | undefined;
    const listeners = new Set<(timestamp: number) => void>();

    function notify(listener: (timestamp: number) => void, timestamp: number): void {
        try {
            listener(timestamp);
        } catch (error) {
            logger.error('[time-service] Error while notifying a server sync listener.', error);
        }
    }

    return {
        get serverTime(): number {
            return Date.now() + serverTimeDelta;
        },
        set serverTime(value: number) {
            serverTimeDelta = value - Date.now();
            lastSync = value;
            logger.debug(`[time-service] Server time delta has been set to: ${serverTimeDelta}ms`);
            for (const listener of listeners) {
                notify(listener, value);
            }
        },
        onSync(listener: (timestamp: number) => void): void {
            listeners.add(listener);
            if (lastSync !== undefined) {
                notify(listener, lastSync);
            }
        },
    };
}
