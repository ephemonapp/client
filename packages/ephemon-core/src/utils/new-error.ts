import { Logger } from './logger';

/** This utility function ensures all errors are properly logged before being thrown. */
export function newError(logger: Logger, message?: string): Error {
    const error = new Error(message);
    logger.error(error);
    return error;
}
