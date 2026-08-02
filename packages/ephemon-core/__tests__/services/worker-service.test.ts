import { createMockLogger, createMockNavigator, createMockServiceWorker } from '../../__mocks__/test-utils';
import { getWorkerService } from '../../src/services/worker-service';
import { Logger } from '../../src/utils/logger';

type WorkerServiceEffectiveConfig = {
    version: string;
    onNewVersion?: () => void;
    navigator: Navigator;
};

describe('WorkerService', () => {
    let workerService: ReturnType<typeof getWorkerService>;
    let mockLogger: Logger;
    let mockRegister: Mock;
    let mockAddEventListener: Mock;
    let mockServiceWorker: any;
    let mockNavigator: any;

    beforeEach(() => {
        mockLogger = createMockLogger();

        mockRegister = vi.fn();
        mockAddEventListener = vi.fn();
        mockServiceWorker = createMockServiceWorker({
            register: mockRegister,
            addEventListener: mockAddEventListener,
        });
        mockNavigator = createMockNavigator({ serviceWorker: mockServiceWorker });

        mockRegister.mockReset();
        mockAddEventListener.mockReset();
        mockRegister.mockResolvedValue({ scope: 'http://localhost/' });

        workerService = getWorkerService(mockLogger);
    });

    describe('initialize', () => {
        it('should register service worker with correct version', async () => {
            const config: WorkerServiceEffectiveConfig = {
                version: '1.0.0',
                navigator: mockNavigator,
            };

            await workerService.initialize(config);

            expect(mockRegister).toHaveBeenCalledWith('/service-worker.js?_=1.0.0');
            expect(mockLogger.debug).toHaveBeenCalledWith(
                '[worker-service] Registered with scope:',
                'http://localhost/',
            );
            expect(mockLogger.debug).toHaveBeenCalledWith('[worker-service] Ready to use.');
            expect(mockLogger.debug).toHaveBeenCalledWith('[worker-service] Initialized.');
            expect(mockNavigator.serviceWorker.register).toHaveBeenCalledWith('/service-worker.js?_=1.0.0');
            expect(mockNavigator.serviceWorker.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
        });

        it('should handle registration errors gracefully', async () => {
            const config: WorkerServiceEffectiveConfig = {
                version: '1.0.0',
                navigator: mockNavigator,
            };
            const error = new Error('Registration failed');
            mockRegister.mockRejectedValue(error);

            await workerService.initialize(config);

            expect(mockRegister).toHaveBeenCalledWith('/service-worker.js?_=1.0.0');
            expect(mockLogger.warn).toHaveBeenCalledWith('[worker-service] Error registering:', error);
            expect(mockLogger.debug).toHaveBeenCalledWith('[worker-service] Initialized.');
        });

        it('should handle browsers without service worker support', async () => {
            const config: WorkerServiceEffectiveConfig = {
                version: '1.0.0',
                navigator: createMockNavigator({}),
            } as any;

            await workerService.initialize(config);

            expect(mockRegister).not.toHaveBeenCalled();
            expect(mockLogger.warn).toHaveBeenCalledWith(
                '[worker-service] Service Worker is not supported in this browser.',
            );
        });

        it('should call onNewVersion callback when receiving message', async () => {
            const mockCallback = vi.fn();
            const config: WorkerServiceEffectiveConfig = {
                version: '1.0.0',
                navigator: mockNavigator,
                onNewVersion: mockCallback,
            };

            await workerService.initialize(config);

            expect(mockAddEventListener).toHaveBeenCalledWith('message', expect.any(Function));

            const handler = mockAddEventListener.mock.calls[0][1];
            handler({ data: { type: 'NEW_VERSION_AVAILABLE' } });

            expect(mockLogger.debug).toHaveBeenCalledWith('[worker-service] New version is available.');
            expect(mockCallback).toHaveBeenCalled();
        });

        it('should not call onNewVersion callback when receiving message with different type', async () => {
            const mockCallback = vi.fn();
            const config: WorkerServiceEffectiveConfig = {
                version: '1.0.0',
                navigator: mockNavigator,
                onNewVersion: mockCallback,
            };

            await workerService.initialize(config);

            expect(mockAddEventListener).toHaveBeenCalledWith('message', expect.any(Function));

            const handler = mockAddEventListener.mock.calls[0][1];
            handler({ data: { type: 'SOME_OTHER_TYPE' } });

            expect(mockLogger.debug).not.toHaveBeenCalledWith('[worker-service] New version is available.');
            expect(mockCallback).not.toHaveBeenCalled();
        });

        it('should not throw if onNewVersion is not provided and NEW_VERSION_AVAILABLE message is received', async () => {
            const config: WorkerServiceEffectiveConfig = {
                version: '1.0.0',
                navigator: mockNavigator,
            };

            await workerService.initialize(config);

            expect(mockAddEventListener).toHaveBeenCalledWith('message', expect.any(Function));

            const handler = mockAddEventListener.mock.calls[0][1];
            expect(() => handler({ data: { type: 'NEW_VERSION_AVAILABLE' } })).not.toThrow();
            expect(mockLogger.debug).toHaveBeenCalledWith('[worker-service] New version is available.');
        });
    });

    describe('getters', () => {
        it('should return the correct registration value', async () => {
            const config: WorkerServiceEffectiveConfig = { version: '1.0.0', navigator: mockNavigator };

            await workerService.initialize(config);

            expect(workerService.registration).toEqual({ scope: 'http://localhost/' });
        });

        it('should return the correct container value', async () => {
            const config: WorkerServiceEffectiveConfig = { version: '1.0.0', navigator: mockNavigator };

            await workerService.initialize(config);

            expect(workerService.container).toBe(mockServiceWorker);
        });

        it('should return the correct controller value', async () => {
            const config: WorkerServiceEffectiveConfig = { version: '1.0.0', navigator: mockNavigator };

            await workerService.initialize(config);

            expect(workerService.controller).toBe(mockServiceWorker.controller);
        });
    });
});
