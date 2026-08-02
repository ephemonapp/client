import { Logger } from './logger';

/** Error raised when a signaling call cannot be delivered. Carries the facts a caller needs to tell the two failure modes apart: a server that refused the call answered and reported a CallError.reason, while a server we never reached leaves it absent. */
export interface CallError extends Error {
    serverUrl?: string;

    /** Present only when the server answered at all. */
    reason?: string;
}

export function newCallError(logger: Logger, message: string, serverUrl?: string, reason?: string): CallError {
    const error: CallError = Object.assign(new Error(message), {
        serverUrl: serverUrl,
        reason: reason,
    });
    logger.error(error);
    return error;
}

export function isCallError(value: unknown): value is CallError {
    return value instanceof Error && ('serverUrl' in value || 'reason' in value);
}
