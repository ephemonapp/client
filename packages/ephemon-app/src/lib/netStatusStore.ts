import { NetStatus } from './status';
import { Ephemon } from '@ephemon/core';

export const UNSTABLE_AFTER = 90 * 1000;
export const OFFLINE_AFTER = 3 * 60 * 1000;

type ServerClock = Pick<Ephemon, 'serverTime' | 'onServerSync'>;

const listeners = new Set<() => void>();

let status: NetStatus = 'connecting';
let lastSyncAt: number | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let tracked: ServerClock | undefined;

function setStatus(next: NetStatus) {
    if (status === next) return;
    status = next;
    for (const listener of listeners) {
        listener();
    }
}

function evaluate() {
    if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
    }
    if (lastSyncAt === undefined) {
        setStatus('connecting');
        return;
    }
    const silence = Date.now() - lastSyncAt;
    if (silence < UNSTABLE_AFTER) {
        setStatus('connected');
        timer = setTimeout(evaluate, UNSTABLE_AFTER - silence);
    } else if (silence < OFFLINE_AFTER) {
        setStatus('unstable');
        timer = setTimeout(evaluate, OFFLINE_AFTER - silence);
    } else {
        setStatus('offline');
    }
}

export function trackServerSync(ephemon: ServerClock) {
    if (tracked === ephemon) return;
    tracked = ephemon;
    ephemon.onServerSync((timestamp) => {
        lastSyncAt = Date.now() - Math.max(0, ephemon.serverTime - timestamp);
        evaluate();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            evaluate();
        }
    });
}

export function subscribeNetStatus(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getNetStatus(): NetStatus {
    return status;
}
