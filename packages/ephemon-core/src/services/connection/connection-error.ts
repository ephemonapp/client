import { isCallError } from '../../utils/call-error';

/** What stopped a connection attempt, in the only three shapes the client can tell apart on its own. Everything finer than that — a server that is down versus one that refuses this app versus one the browser will not let an https page talk to — cannot be told apart from a failed call alone, and is for the application to probe for. */
export type ConnectionIssue = 'peer-unreachable' | 'signalling-rejected' | 'signalling-unavailable';

/** Why the last connection attempt stopped, reported in facts rather than prose so that the application can word it however it likes. */
export interface ConnectionError {
    issue: ConnectionIssue;

    serverUrl?: string;
}

/** How the server words a peer it cannot route to. Prose from the server is a poor discriminator, but it is the only one the protocol offers: a refusal carries nothing but `ok: false` and this sentence. */
const PEER_UNREACHABLE_REASON = /is not reachable/i;

export function classifyCallError(error: unknown): ConnectionError {
    if (!isCallError(error)) {
        return { issue: 'signalling-unavailable' };
    }
    if (error.reason === undefined) {
        return { issue: 'signalling-unavailable', serverUrl: error.serverUrl };
    }
    return {
        issue: PEER_UNREACHABLE_REASON.test(error.reason) ? 'peer-unreachable' : 'signalling-rejected',
        serverUrl: error.serverUrl,
    };
}
