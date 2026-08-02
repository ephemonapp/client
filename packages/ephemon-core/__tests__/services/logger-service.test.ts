import { getLoggerService, LoggerServiceConfig } from '../../src/services/logger-service';

describe('LoggerService', () => {
    let loggerService: ReturnType<typeof getLoggerService>;
    let mockConfig: LoggerServiceConfig;

    beforeEach(() => {
        mockConfig = {
            onTrace: vi.fn(),
            onDebug: vi.fn(),
            onLog: vi.fn(),
            onWarn: vi.fn(),
            onError: vi.fn(),
        };
        loggerService = getLoggerService();
    });

    it('should initialize with config callbacks', () => {
        loggerService.initialize(mockConfig);

        expect(mockConfig.onDebug).toHaveBeenCalledWith('[logger-service] Initialized.');
    });

    it('should call onTrace when trace is called', () => {
        loggerService.initialize(mockConfig);
        const args = ['test message', { data: 'test' }];

        loggerService.trace(...args);

        expect(mockConfig.onTrace).toHaveBeenCalledWith(...args);
    });

    it('should call onDebug when debug is called', () => {
        loggerService.initialize(mockConfig);
        const args = ['test message', { data: 'test' }];

        loggerService.debug(...args);

        expect(mockConfig.onDebug).toHaveBeenCalledWith(...args);
    });

    it('should call onLog when log is called', () => {
        loggerService.initialize(mockConfig);
        const args = ['test message', { data: 'test' }];

        loggerService.log(...args);

        expect(mockConfig.onLog).toHaveBeenCalledWith(...args);
    });

    it('should call onWarn when warn is called', () => {
        loggerService.initialize(mockConfig);
        const args = ['test message', { data: 'test' }];

        loggerService.warn(...args);

        expect(mockConfig.onWarn).toHaveBeenCalledWith(...args);
    });

    it('should call onError when error is called', () => {
        loggerService.initialize(mockConfig);
        const args = ['test message', { data: 'test' }];

        loggerService.error(...args);

        expect(mockConfig.onError).toHaveBeenCalledWith(...args);
    });

    it('should not throw if onTrace is not provided', () => {
        const partialConfig: LoggerServiceConfig = {
            onDebug: vi.fn(),
            onLog: vi.fn(),
            onWarn: vi.fn(),
            onError: vi.fn(),
        };
        loggerService.initialize(partialConfig);

        expect(() => loggerService.trace('test')).not.toThrow();
    });

    it('should not throw if onDebug is not provided', () => {
        const partialConfig: LoggerServiceConfig = {
            onTrace: vi.fn(),
            onLog: vi.fn(),
            onWarn: vi.fn(),
            onError: vi.fn(),
        };
        loggerService.initialize(partialConfig);

        expect(() => loggerService.debug('test')).not.toThrow();
    });

    it('should not throw if onLog is not provided', () => {
        const partialConfig: LoggerServiceConfig = {
            onTrace: vi.fn(),
            onDebug: vi.fn(),
            onWarn: vi.fn(),
            onError: vi.fn(),
        };
        loggerService.initialize(partialConfig);

        expect(() => loggerService.log('test')).not.toThrow();
    });

    it('should not throw if onWarn is not provided', () => {
        const partialConfig: LoggerServiceConfig = {
            onTrace: vi.fn(),
            onDebug: vi.fn(),
            onLog: vi.fn(),
            onError: vi.fn(),
        };
        loggerService.initialize(partialConfig);

        expect(() => loggerService.warn('test')).not.toThrow();
    });

    it('should not throw if onError is not provided', () => {
        const partialConfig: LoggerServiceConfig = {
            onTrace: vi.fn(),
            onDebug: vi.fn(),
            onLog: vi.fn(),
            onWarn: vi.fn(),
        };
        loggerService.initialize(partialConfig);

        expect(() => loggerService.error('test')).not.toThrow();
    });
});
