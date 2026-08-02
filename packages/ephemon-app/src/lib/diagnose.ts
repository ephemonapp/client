import { NoticeCode } from './notice';
import { ConnectionIssue } from '@ephemon/core';

const PROBE_PATH = '/health';
const PROBE_TIMEOUT = 4000;

function isBlockedAsInsecure(serverUrl: string): boolean {
    try {
        return location.protocol === 'https:' && new URL(serverUrl).protocol === 'http:';
    } catch {
        return false;
    }
}

/**
 * An opaque probe: `no-cors` sidesteps the very policy we are trying to detect, so the request
 * settles on whether the server answered at all — not on whether it would let this app in.
 */
async function isAnswering(serverUrl: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
    try {
        await fetch(`${serverUrl.replace(/\/+$/, '')}${PROBE_PATH}`, {
            mode: 'no-cors',
            cache: 'no-store',
            signal: controller.signal,
        });
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Turns "no channel to that server" into the reason a user can act on. The core cannot tell a
 * server that is down from one that refuses this app — from a failed call both look identical —
 * so the difference has to be probed for here.
 *
 * @param issue - What the core could establish on its own
 * @param serverUrl - The server the issue concerns
 * @returns The most specific notice the browser can justify
 */
export async function diagnose(issue: ConnectionIssue, serverUrl: string | undefined): Promise<NoticeCode> {
    if (issue !== 'signalling-unavailable' || serverUrl === undefined) {
        return issue;
    }
    if (isBlockedAsInsecure(serverUrl)) {
        return 'server-insecure';
    }
    return (await isAnswering(serverUrl)) ? 'server-private' : 'server-offline';
}
