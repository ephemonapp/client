import { createMockLogger } from '../../__mocks__/test-utils';
import { newError } from '../../src/utils/new-error';

describe('newError utility', () => {
    let logger: ReturnType<typeof createMockLogger>;
    beforeEach(() => {
        logger = createMockLogger();
    });

    it('should create a new Error with the given message and log it', () => {
        const errorMessage = 'Test error message';

        const error = newError(logger, errorMessage);

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe(errorMessage);
        expect(logger.error).toHaveBeenCalledWith(error);
    });

    it('should handle undefined message', () => {
        const error = newError(logger);

        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('');
        expect(logger.error).toHaveBeenCalledWith(error);
    });
});
