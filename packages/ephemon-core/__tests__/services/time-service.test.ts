import { createMockLogger, mockDateNow, restoreDateNow } from '../../__mocks__/test-utils';
import { getTimeService, TimeService } from '../../src/services/time-service';
import { Logger } from '../../src/utils/logger';

describe('TimeService', () => {
    let timeService: TimeService;
    let mockLogger: Logger;
    let originalDateNow: typeof Date.now;

    beforeEach(() => {
        mockLogger = createMockLogger();

        originalDateNow = Date.now;
        mockDateNow(1000);

        timeService = getTimeService(mockLogger);
    });

    afterEach(() => {
        restoreDateNow(originalDateNow);
    });

    describe('serverTime getter', () => {
        it('should return current time when no delta is set', () => {
            const result = timeService.serverTime;

            expect(Date.now).toHaveBeenCalled();
            expect(result).toBe(1000);
        });

        it('should return current time plus delta when delta is set', () => {
            timeService.serverTime = 2000;

            const result = timeService.serverTime;

            expect(Date.now).toHaveBeenCalled();
            expect(result).toBe(2000);
        });
    });

    describe('serverTime setter', () => {
        it('should set the server time delta correctly', () => {
            const serverTime = 5000;

            timeService.serverTime = serverTime;

            expect(mockLogger.debug).toHaveBeenCalledWith('[time-service] Server time delta has been set to: 4000ms');
            expect(timeService.serverTime).toBe(5000);
        });

        it('should update the server time delta when set multiple times', () => {
            timeService.serverTime = 5000;

            timeService.serverTime = 3000;

            expect(mockLogger.debug).toHaveBeenLastCalledWith(
                '[time-service] Server time delta has been set to: 2000ms',
            );
            expect(timeService.serverTime).toBe(3000);
        });

        it('should handle negative server time delta', () => {
            timeService.serverTime = 500;

            expect(mockLogger.debug).toHaveBeenCalledWith('[time-service] Server time delta has been set to: -500ms');
            expect(timeService.serverTime).toBe(500);
        });
    });

    describe('onSync', () => {
        it('should not notify a listener when no synchronization has happened yet', () => {
            const listener = vi.fn();

            timeService.onSync(listener);

            expect(listener).not.toHaveBeenCalled();
        });

        it('should notify every registered listener on each synchronization', () => {
            const first = vi.fn();
            const second = vi.fn();
            timeService.onSync(first);
            timeService.onSync(second);

            timeService.serverTime = 5000;
            timeService.serverTime = 7000;

            expect(first).toHaveBeenNthCalledWith(1, 5000);
            expect(first).toHaveBeenNthCalledWith(2, 7000);
            expect(second).toHaveBeenNthCalledWith(1, 5000);
            expect(second).toHaveBeenNthCalledWith(2, 7000);
        });

        it('should notify a late listener with the most recent timestamp immediately', () => {
            timeService.serverTime = 5000;
            timeService.serverTime = 7000;
            const listener = vi.fn();

            timeService.onSync(listener);

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(7000);
        });

        it('should swallow and log an error thrown by a listener', () => {
            const error = new Error('listener failure');
            const failing = vi.fn(() => {
                throw error;
            });
            const healthy = vi.fn();
            timeService.onSync(failing);
            timeService.onSync(healthy);

            expect(() => (timeService.serverTime = 5000)).not.toThrow();

            expect(mockLogger.error).toHaveBeenCalledWith(
                '[time-service] Error while notifying a server sync listener.',
                error,
            );
            expect(healthy).toHaveBeenCalledWith(5000);
        });
    });

    it('should update serverTime correctly when Date.now changes', () => {
        timeService.serverTime = 5000;

        mockDateNow(2000);

        expect(timeService.serverTime).toBe(6000);
    });
});
