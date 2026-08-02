import { createMockLogger } from '../../__mocks__/test-utils';
import { CallData } from '../../src/models/infrasctructure/call-data';
import { CallMethodName } from '../../src/models/infrasctructure/call-method-name';
import { CallRequest } from '../../src/models/infrasctructure/call-request';
import { getSignalRService, SignalRServiceConfig } from '../../src/services/signalr-service';
import { Logger } from '../../src/utils/logger';
import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';

vi.mock('@microsoft/signalr');

interface TestCallData extends CallData {
    a: string;
    testProp?: string;
}

describe('SignalRService', () => {
    let signalRService: ReturnType<typeof getSignalRService>;
    let mockLogger: Logger;
    let mockHubConnection: Mocked<HubConnection>;
    let mockHubBuilder: any;
    let mockConfig: SignalRServiceConfig & {
        onCall: Mock;
        onReady: Mock;
        initializationTimeout: number;
        readyTimeout: number;
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mockLogger = createMockLogger();

        mockConfig = {
            serverUrl: 'https://test-server.com',
            onCall: vi.fn().mockResolvedValue(undefined),
            onReady: vi.fn().mockResolvedValue(undefined),
            initializationTimeout: 50,
            readyTimeout: 100,
        };

        signalRService = getSignalRService(mockLogger);

        mockHubConnection = new HubConnectionBuilder().build() as Mocked<HubConnection>;
        mockHubBuilder = new HubConnectionBuilder();
    });

    describe('initialize', () => {
        it('should create a SignalR connection with correct parameters', async () => {
            await signalRService.initialize(mockConfig);

            expect(mockHubBuilder.withUrl).toHaveBeenCalledWith('https://test-server.com/signal/v1');
            expect(mockHubBuilder.withAutomaticReconnect).toHaveBeenCalled();
            expect(mockHubBuilder.configureLogging).toHaveBeenCalledWith(LogLevel.None);
            expect(mockHubBuilder.build).toHaveBeenCalled();

            expect(mockHubConnection.start).toHaveBeenCalled();
            expect(mockHubConnection.onreconnecting).toHaveBeenCalled();
            expect(mockHubConnection.onreconnected).toHaveBeenCalled();
            expect(mockHubConnection.on).toHaveBeenCalledWith('call', expect.any(Function));

            expect(mockLogger.debug).toHaveBeenCalledWith('[signalr-service] SignalR is ready.');
            expect(mockConfig.onReady).toHaveBeenCalled();
        });

        it('should use correct retry delay strategy', async () => {
            await signalRService.initialize(mockConfig);

            const retryParams = mockHubBuilder.withAutomaticReconnect.mock.calls[0][0];
            const nextRetryDelayFn = retryParams.nextRetryDelayInMilliseconds;

            expect(nextRetryDelayFn({ previousRetryCount: 0 })).toBe(5000);
            expect(nextRetryDelayFn({ previousRetryCount: 1 })).toBe(5000);
            expect(nextRetryDelayFn({ previousRetryCount: 4 })).toBe(5000);
            expect(nextRetryDelayFn({ previousRetryCount: 10 })).toBe(11000);
        });

        it('should handle connection errors gracefully', async () => {
            const error = new Error('Connection error');
            mockHubConnection.start.mockRejectedValueOnce(error);

            await signalRService.initialize(mockConfig);

            expect(mockLogger.error).toHaveBeenCalledWith('[signalr-service] SignalR connection error.', error.message);
            expect(signalRService.ready).toBe(false);
        });

        it('should retry connection via setTimeout and increment retryCount', async () => {
            vi.useFakeTimers();
            const error = new Error('Connection error');
            mockHubConnection.start.mockRejectedValueOnce(error);

            const initPromise = signalRService.initialize(mockConfig);
            await Promise.resolve();
            vi.advanceTimersByTime(mockConfig.initializationTimeout);
            await initPromise;

            await Promise.resolve();

            expect(mockHubConnection.start).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(1000);

            await Promise.resolve();

            expect(mockHubConnection.start).toHaveBeenCalledTimes(2);

            vi.useRealTimers();
        });

        it('should setup reconnect handlers correctly', async () => {
            await signalRService.initialize(mockConfig);

            const reconnectingHandler = mockHubConnection.onreconnecting.mock.calls[0][0];
            const reconnectedHandler = mockHubConnection.onreconnected.mock.calls[0][0];

            reconnectingHandler();

            expect(mockLogger.warn).toHaveBeenCalledWith('[signalr-service] Reconnecting ...');
            expect(signalRService.ready).toBe(false);

            await reconnectedHandler();

            expect(mockLogger.warn).toHaveBeenCalledWith('[signalr-service] Reconnected.');
            expect(signalRService.ready).toBe(true);
            expect(mockConfig.onReady).toHaveBeenCalledTimes(2);
        });

        it('should handle incoming call messages correctly', async () => {
            await signalRService.initialize(mockConfig);

            const callHandler = mockHubConnection.on.mock.calls[0][1];

            const validPayload = { a: 'testMethod', b: { data: 'test' } };

            await callHandler(validPayload);

            expect(mockLogger.debug).toHaveBeenCalledWith('[signalr-service] Message received.', validPayload);
            expect(mockConfig.onCall).toHaveBeenCalledWith(validPayload);
        });

        it('should handle missing onCall callback', async () => {
            const configWithoutOnCall = {
                serverUrl: 'https://test-server.com',
                onReady: vi.fn().mockResolvedValue(undefined),
                initializationTimeout: 50,
                readyTimeout: 100,
            };

            await signalRService.initialize(configWithoutOnCall as any);

            const callHandler = mockHubConnection.on.mock.calls[0][1];

            await callHandler({ a: 'testMethod' });

            expect(mockLogger.warn).toHaveBeenCalledWith(
                '[signalr-service] Signalling message callback is not initialized.',
            );
        });

        it('should handle invalid payloads', async () => {
            await signalRService.initialize(mockConfig);

            const callHandler = mockHubConnection.on.mock.calls[0][1];

            await callHandler(null);

            expect(mockLogger.error).toHaveBeenCalledWith('[signalr-service] Invalid payload data.');

            await callHandler({ someOtherProp: 'test' });

            expect(mockLogger.error).toHaveBeenCalledWith('[signalr-service] Invalid payload data.');
        });

        it('should handle onCall handler errors', async () => {
            const error = new Error('Handler error');
            mockConfig.onCall.mockRejectedValueOnce(error);

            await signalRService.initialize(mockConfig);

            const callHandler = mockHubConnection.on.mock.calls[0][1];

            await callHandler({ a: 'testMethod' });

            expect(mockLogger.error).toHaveBeenCalledWith(
                '[signalr-service] Error while processing signalR call.',
                error.message,
            );
        });
    });

    describe('call', () => {
        beforeEach(async () => {
            await signalRService.initialize(mockConfig);
        });

        it('should invoke HubConnection with correct parameters', async () => {
            const request: CallRequest<TestCallData> = {
                a: 'testMethod' as CallMethodName,
                b: {
                    a: 'test-public-key',
                },
                c: 'signature',
            };

            const response = {
                ok: true,
                timestamp: Date.now(),
            };

            mockHubConnection.invoke.mockResolvedValueOnce(response);

            const result = await signalRService.call(request);

            expect(mockHubConnection.invoke).toHaveBeenCalledWith('call', request);
            expect(mockLogger.debug).toHaveBeenCalled();
            expect(result).toBe(response);
        });

        it('should handle null/undefined response', async () => {
            const request: CallRequest<TestCallData> = {
                a: 'testMethod' as CallMethodName,
                b: {
                    a: 'test-public-key',
                },
                c: 'signature',
            };

            mockHubConnection.invoke.mockResolvedValueOnce(null);

            try {
                await signalRService.call(request);
                expect('Should have thrown').toBe('But did not throw');
            } catch (error: any) {
                expect(String(error)).toContain('Unexpected answer on call testMethod from');
                expect(mockLogger.error).toHaveBeenCalled();
            }
        });

        it('should handle response with ok:false', async () => {
            const request: CallRequest<TestCallData> = {
                a: 'testMethod' as CallMethodName,
                b: {
                    a: 'test-public-key',
                },
                c: 'signature',
            };

            const response = {
                ok: false,
                timestamp: Date.now(),
                reason: 'Something went wrong',
            };

            mockHubConnection.invoke.mockResolvedValueOnce(response);

            await expect(signalRService.call(request)).rejects.toThrow(/Request was not successful/);
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should handle signalR invoke errors', async () => {
            const request: CallRequest<TestCallData> = {
                a: 'testMethod' as CallMethodName,
                b: {
                    a: 'test-public-key',
                },
                c: 'signature',
            };

            const error = new Error('SignalR invoke error');
            mockHubConnection.invoke.mockRejectedValueOnce(error);

            await expect(signalRService.call(request)).rejects.toBe(error);
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error while sending request'),
                expect.anything(),
                expect.anything(),
            );
        });

        it('should throw error when connection is not initialized', async () => {
            const newService = getSignalRService(mockLogger);

            const request: CallRequest<TestCallData> = {
                a: 'testMethod' as CallMethodName,
                b: {
                    a: 'test-public-key',
                },
                c: 'signature',
            };

            try {
                await newService.call(request);
                expect('Should have thrown').toBe('But did not throw');
            } catch (error: any) {
                expect(error.message).toBe('[signalr-service] SignalR connection is not initialized.');
                expect(mockLogger.error).toHaveBeenCalled();
            }
        });

        it('should wait for readyPromise when connection is reconnecting', async () => {
            await signalRService.initialize(mockConfig);

            const reconnectingHandler = mockHubConnection.onreconnecting.mock.calls[0][0];
            const reconnectedHandler = mockHubConnection.onreconnected.mock.calls[0][0];

            reconnectingHandler();

            const response = { ok: true, timestamp: Date.now() };
            mockHubConnection.invoke.mockResolvedValueOnce(response);

            const request: CallRequest<TestCallData> = {
                a: 'testMethod' as CallMethodName,
                b: { a: 'test-public-key' },
                c: 'signature',
            };

            const callPromise = signalRService.call(request);

            await reconnectedHandler();

            const result = await callPromise;

            expect(result).toBe(response);
            expect(mockHubConnection.invoke).toHaveBeenCalledWith('call', request);
        });
    });
});
