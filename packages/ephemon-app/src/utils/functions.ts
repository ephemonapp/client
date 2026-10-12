import { getEphemonCore } from '../lib/ephemonCore';

export function showNotification(title: string, options?: NotificationOptions) {
    getEphemonCore()?.showNotification(title, options);
}

export function now() {
    return Date.now();
}

/** Truncated: the server-anchored value feeds `BigInt` event stamps and record ids, which reject non-integers. */
export function serverTime() {
    return Math.trunc(getEphemonCore()?.serverTime ?? Date.now());
}

export function formatTimestampDate(utcTimestamp: number) {
    if (String(utcTimestamp).length === 10) {
        utcTimestamp *= 1000;
    }

    const date = new Date(utcTimestamp);

    const formatter = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: '2-digit',
    });

    return formatter.format(date);
}

export function formatTimestampLong(utcTimestamp: number) {
    if (String(utcTimestamp).length === 10) {
        utcTimestamp *= 1000;
    }

    const date = new Date(utcTimestamp);

    const formatter = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
    });

    return formatter.format(date);
}

export function formatTimestampShort(utcTimestamp: number) {
    if (String(utcTimestamp).length === 10) {
        utcTimestamp *= 1000;
    }

    const date = new Date(utcTimestamp);

    const formatter = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });

    return formatter.format(date);
}
