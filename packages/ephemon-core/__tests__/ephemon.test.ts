import {
    createMockKeyPair,
    createMockLogger,
    createMockEphemonConfig,
    mockEphemonCoreServices,
    setupEphemonBrowserMocks,
    teardownEphemonBrowserMocks,
} from '../__mocks__/test-utils';
import type { Ephemon, EphemonPrototype } from '../src/ephemon';
import { ConnectionState } from '../src/services/connection/connection';
import { Logger } from '../src/utils/logger';

const mockNavigator = { serviceWorker: {} };
let getWorkerService: any;
let getSessionService: any;
let getPushService: any;
let getSignalRService: any;
let getHandleService: any;
let getConnectionService: any;
let getCallService: any;
let getCryptography: any;
let getTimeService: any;
let translateConnection: any;
let serviceMocks: ReturnType<typeof mockEphemonCoreServices>;

mockEphemonCoreServices();
setupEphemonBrowserMocks();

describe('Ephemon', () => {
    let ephemonPrototype: EphemonPrototype;
    let mockLogger: Logger;

    beforeEach(async () => {
        vi.resetModules();
        serviceMocks = mockEphemonCoreServices();
        vi.clearAllMocks();

        mockLogger = createMockLogger();

        const ephemonModule = await import('../src/ephemon');
        const { getPrototype } = ephemonModule;
        getWorkerService = () => serviceMocks.workerServiceMock;
        getSessionService = () => serviceMocks.sessionServiceMock;
        getPushService = () => serviceMocks.pushServiceMock;
        getSignalRService = () => serviceMocks.signalRServiceMock;
        getHandleService = () => serviceMocks.handleServiceMock;
        getConnectionService = () => serviceMocks.connectionServiceMock;
        getCallService = () => serviceMocks.callServiceMock;
        getCryptography = () => serviceMocks.cryptographyMock;
        getTimeService = () => serviceMocks.timeServiceMock;
        translateConnection = serviceMocks.translateConnectionMock;
        ephemonPrototype = getPrototype(mockLogger);
    });

    afterAll(() => {
        teardownEphemonBrowserMocks();
    });

    describe('getPrototype', () => {
        it('should create a EphemonPrototype instance', () => {
            expect(ephemonPrototype).toBeDefined();
            expect(ephemonPrototype.initialize).toBeInstanceOf(Function);
            expect(ephemonPrototype.generateSigningKeyPair).toBeInstanceOf(Function);
        });
    });

    describe('initialize', () => {
        const mockKeyPair = createMockKeyPair();
        const mockConfig = createMockEphemonConfig({ signingKeyPair: mockKeyPair, navigator: mockNavigator });

        it('should initialize all services in the correct order', async () => {
            const ephemon = await ephemonPrototype.initialize(mockConfig);

            expect(getWorkerService().initialize).toHaveBeenCalledWith(
                expect.objectContaining({
                    serverUrl: 'https://test-server.com',
                    onCall: expect.any(Function),
                    onReady: expect.any(Function),
                    focusOnDial: expect.any(Function),
                    requestDial: expect.any(Function),
                    version: '1.0.0',
                    signingKeyPair: expect.any(Object),
                    vapidKey: 'test-vapid-key',
                    iceServers: [{ urls: 'stun:test.com' }],
                }),
            );
            expect(getSessionService().initialize).toHaveBeenCalledWith(mockConfig);
            expect(getPushService().initialize).toHaveBeenCalledWith(
                expect.objectContaining({
                    ...mockConfig,
                    onCall: expect.any(Function),
                }),
            );
            expect(getSignalRService().initialize).toHaveBeenCalledWith(
                expect.objectContaining({
                    ...mockConfig,
                    onCall: expect.any(Function),
                    onReady: expect.any(Function),
                }),
            );
            expect(getHandleService().initialize).toHaveBeenCalledWith(mockConfig);

            expect(getConnectionService().initialize).toHaveBeenCalledWith(
                expect.objectContaining({
                    ...mockConfig,
                    webRTC: expect.objectContaining({
                        PeerConnection: expect.any(Function),
                        DataChannel: expect.any(Function),
                    }),
                }),
            );

            expect(getCallService().initialize).toHaveBeenCalledWith(
                expect.objectContaining({
                    serverUrl: 'https://test-server.com',
                    onCall: expect.any(Function),
                    onReady: expect.any(Function),
                    focusOnDial: expect.any(Function),
                    requestDial: expect.any(Function),
                    version: '1.0.0',
                    signingKeyPair: expect.any(Object),
                    vapidKey: 'test-vapid-key',
                    iceServers: [{ urls: 'stun:test.com' }],
                }),
            );

            for (const initialize of [getSignalRService().initialize, getPushService().initialize]) {
                const { onCall } = initialize.mock.calls[0][0];
                await onCall({ a: 'dial', b: '{}', c: 'signature' });
                expect(getHandleService().call).toHaveBeenLastCalledWith(
                    { a: 'dial', b: '{}', c: 'signature' },
                    getTimeService(),
                );
            }

            const workerService = getWorkerService();
            expect(workerService.controller.postMessage).not.toHaveBeenCalled();

            expect(mockLogger.log).toHaveBeenCalledWith('[ephemon] Initialized.');

            expect(ephemon.publicKey).toBe('test-public-key-safe');
            expect(ephemon.serverTime).toBe(12345);
            expect(typeof ephemon.onServerSync).toBe('function');
            expect(ephemon.connections).toEqual([]);
            expect(typeof ephemon.get).toBe('function');
            expect(typeof ephemon.delete).toBe('function');
            expect(typeof ephemon.showNotification).toBe('function');
        });

        it('should handle parallel initialization attempts', async () => {
            const promise1 = ephemonPrototype.initialize(mockConfig);
            const promise2 = ephemonPrototype.initialize(mockConfig);

            const [ephemon1, ephemon2] = await Promise.all([promise1, promise2]);
            expect(ephemon1).toBe(ephemon2);
            expect(mockLogger.warn).toHaveBeenCalledWith('[ephemon] Parallel initialization attempt.');
            expect(mockLogger.log).toHaveBeenCalledWith('[ephemon] Initialized.');
        });

        it('should set up a periodic update call', async () => {
            const ephemon = await ephemonPrototype.initialize(mockConfig);

            const callService = getCallService();

            callService.update.mockClear();

            await vi.advanceTimersByTimeAsync(60 * 1000);

            expect(callService.update).toHaveBeenCalledWith('test-public-key', expect.anything());
        });

        it('should notify the service worker after every successful update call', async () => {
            getCallService().update.mockResolvedValue({ ok: true, timestamp: 12345 });

            await ephemonPrototype.initialize(mockConfig);

            const workerService = getWorkerService();
            expect(workerService.controller.postMessage).toHaveBeenCalledTimes(1);
            expect(workerService.controller.postMessage).toHaveBeenCalledWith({ type: 'CLIENT_READY' });

            await vi.advanceTimersByTimeAsync(60 * 1000);

            expect(workerService.controller.postMessage).toHaveBeenCalledTimes(2);
        });

        it('should not notify the service worker when the update call is refused', async () => {
            getCallService().update.mockResolvedValue({ ok: false, timestamp: 12345 });

            await ephemonPrototype.initialize(mockConfig);

            expect(getWorkerService().controller.postMessage).not.toHaveBeenCalled();
        });

        it('should not throw on a successful update call when there is no service worker controller', async () => {
            getCallService().update.mockResolvedValue({ ok: true, timestamp: 12345 });
            serviceMocks.workerServiceMock.controller = undefined as any;

            const ephemon = await ephemonPrototype.initialize(mockConfig);

            expect(ephemon).toBeDefined();
            expect(mockLogger.log).toHaveBeenCalledWith('[ephemon] Initialized.');
        });

        it('should handle case when push subscription is not available', async () => {
            getPushService().getSubscription.mockResolvedValueOnce(undefined);

            const mockOnMayWorkUnstably = vi.fn().mockResolvedValue(undefined);
            const configWithCallback = {
                ...mockConfig,
                onMayWorkUnstably: mockOnMayWorkUnstably,
            };

            const ephemon = await ephemonPrototype.initialize(configWithCallback);

            expect(mockOnMayWorkUnstably).toHaveBeenCalledWith(
                'Due to notifications unavailable, this messenger may work unstably.',
            );
        });

        it('should not call onMayWorkUnstably when push subscription is available', async () => {
            getPushService().getSubscription.mockResolvedValueOnce({ endpoint: 'test-endpoint' });

            const mockOnMayWorkUnstably = vi.fn().mockResolvedValue(undefined);
            const configWithCallback = {
                ...mockConfig,
                onMayWorkUnstably: mockOnMayWorkUnstably,
            };

            const ephemon = await ephemonPrototype.initialize(configWithCallback);

            expect(mockOnMayWorkUnstably).not.toHaveBeenCalled();
        });

        it('should not throw if push subscription is not available and onMayWorkUnstably is not provided', async () => {
            getPushService().getSubscription.mockResolvedValueOnce(undefined);

            const ephemon = await ephemonPrototype.initialize(mockConfig);
            expect(ephemon).toBeDefined();
            expect(mockLogger.log).toHaveBeenCalledWith('[ephemon] Initialized.');
        });
    });

    describe('generateSigningKeyPair', () => {
        it('should call cryptography.generateSigningKeyPair', () => {
            const cryptography = getCryptography();

            const result = ephemonPrototype.generateSigningKeyPair();

            expect(cryptography.generateSigningKeyPair).toHaveBeenCalled();
            expect(result).toEqual({ publicKey: expect.any(Uint8Array), secretKey: expect.any(Uint8Array) });
        });
    });

    describe('Ephemon interface', () => {
        let ephemon: Ephemon;

        beforeEach(async () => {
            const mockKeyPair = createMockKeyPair();
            const mockConfig = createMockEphemonConfig({ signingKeyPair: mockKeyPair, navigator: mockNavigator });
            ephemon = await ephemonPrototype.initialize(mockConfig);
        });

        describe('get', () => {
            it('should return existing connection if found', () => {
                const mockConnection = { publicKey: 'test-key', state: ConnectionState.Open };
                getConnectionService().getConnection.mockReturnValueOnce(mockConnection);

                const result = ephemon.get('test-key');

                expect(getConnectionService().getConnection).toHaveBeenCalledWith('test-key');
                expect(result).toEqual(
                    expect.objectContaining({
                        publicKey: 'test-key',
                        state: ConnectionState.Open,
                    }),
                );
            });

            it('should create new outgoing connection if not found', () => {
                getConnectionService().getConnection.mockReturnValueOnce(undefined);
                const mockNewConnection = { publicKey: 'test-key', state: ConnectionState.New };
                getConnectionService().createOutgoing.mockReturnValueOnce(mockNewConnection);

                const result = ephemon.get('test-key');

                expect(getConnectionService().getConnection).toHaveBeenCalledWith('test-key');
                expect(getConnectionService().createOutgoing).toHaveBeenCalledWith('test-key', undefined);
                expect(result).toEqual(
                    expect.objectContaining({
                        publicKey: 'test-key',
                        state: ConnectionState.New,
                    }),
                );
            });

            it('should create the connection pointing at the server the contact carried', () => {
                getConnectionService().getConnection.mockReturnValueOnce(undefined);
                getConnectionService().createOutgoing.mockReturnValueOnce({
                    publicKey: 'test-key',
                    state: ConnectionState.New,
                });

                ephemon.get('test-key', 'https://peer.ephemon.test');

                expect(getConnectionService().createOutgoing).toHaveBeenCalledWith(
                    'test-key',
                    'https://peer.ephemon.test',
                );
            });

            it('should correct the server of a connection that already exists', () => {
                const setServerUrl = vi.fn();
                getConnectionService().getConnection.mockReturnValueOnce({
                    publicKey: 'test-key',
                    state: ConnectionState.Open,
                    setServerUrl,
                });

                ephemon.get('test-key', 'https://moved.ephemon.test');

                expect(setServerUrl).toHaveBeenCalledWith('https://moved.ephemon.test');
                expect(getConnectionService().createOutgoing).not.toHaveBeenCalled();
            });
        });

        describe('delete', () => {
            it('should call connectionService.deleteConnection', () => {
                ephemon.delete('test-key');

                expect(getConnectionService().deleteConnection).toHaveBeenCalledWith('test-key');
            });
        });

        describe('showNotification', () => {
            it('should call pushService.showNotification', () => {
                const options = { body: 'Test notification body' };
                const result = ephemon.showNotification('Test Title', options);

                expect(getPushService().showNotification).toHaveBeenCalledWith('Test Title', options);
                expect(result).toBe(true);
            });
        });

        describe('onServerSync', () => {
            it('should register the listener in timeService', () => {
                const listener = vi.fn();

                ephemon.onServerSync(listener);

                expect(serviceMocks.timeServiceMock.onSync).toHaveBeenCalledWith(listener);
            });
        });

        describe('connections', () => {
            it('should return translated connections from connectionService', () => {
                const mockConnections = [
                    { publicKey: 'key1', state: ConnectionState.Open },
                    { publicKey: 'key2', state: ConnectionState.New },
                ];

                getConnectionService().connections = mockConnections;

                const result = ephemon.connections;

                expect(translateConnection).toHaveBeenCalledTimes(2);
                expect(result.length).toBe(2);
                expect(result[0].publicKey).toBe('key1');
                expect(result[1].publicKey).toBe('key2');
            });
        });
    });
});
