import {
    createMockBase64,
    createMockLogger,
    createMockNotification,
    createMockPushConfig,
    createMockPushManager,
    createMockPushSubscription,
    createMockServiceWorkerContainer,
    createMockWorkerService,
} from '../../__mocks__/test-utils';
import { CallMethodName } from '../../src/models/infrasctructure/call-method-name';
import { CallPayload } from '../../src/models/infrasctructure/call-payload';
import { getPushService, PushServiceConfig } from '../../src/services/push-service';
import { WorkerService } from '../../src/services/worker-service';
import { Base64 } from '../../src/utils/base64';
import { Logger } from '../../src/utils/logger';
import { urlBase64ToUint8Array } from '../../src/utils/web-push-helpers';

interface MockServiceWorkerContainer {
    addEventListener: Mock;
    removeEventListener: Mock;
    dispatchEvent: Mock;
    controller: any;
    oncontrollerchange: null;
    onmessage: null;
    onmessageerror: null;
    ready: Promise<any>;
    getRegistration: Mock;
    getRegistrations: Mock;
    register: Mock;
    startMessages: Mock;
}

describe('PushService', () => {
    let pushService: ReturnType<typeof getPushService>;
    let mockLogger: Logger;
    let mockWorkerService: WorkerService;
    let mockBase64: Base64;
    let mockConfig: PushServiceConfig & {
        onCall: Mock;
        notification?: typeof Notification;
        pushManager?: typeof PushManager;
        urlBase64ToUint8Array: (base64String: string) => Uint8Array;
    };
    let mockRegistration: any;
    let mockPushManager: any;
    let mockController: any;
    let mockPushSubscription: any;
    let mockContainer: any;

    const TEST_EPHEMON_VAPID_KEY =
        'BDuixZ_tK0mDQPXYYuT1zWcql3BKy_y_dJmUVd9M5hTpCkE-BCvqeXGKyKqX2YRxLQIw1x_SZTHxY7MNwUx4hI0';

    beforeEach(() => {
        mockController = { postMessage: vi.fn() };

        mockPushSubscription = createMockPushSubscription();

        mockPushManager = createMockPushManager({}, mockPushSubscription);

        mockRegistration = {
            pushManager: mockPushManager,
            scope: 'https://example.com',
        };

        mockContainer = createMockServiceWorkerContainer({}, mockRegistration, mockController);
        mockContainer.addEventListener.mockClear();

        mockLogger = createMockLogger();

        mockWorkerService = createMockWorkerService({
            registration: mockRegistration,
            container: mockContainer,
            controller: mockController,
        });

        const encodeMock = vi.fn().mockImplementation((data) => {
            return data && data.length > 0 ? `encoded-${data[0]}` : 'encoded-empty';
        });

        mockBase64 = createMockBase64({ '4,5,6': 'encoded-4', '7,8,9': 'encoded-7' });

        pushService = getPushService(mockLogger, mockWorkerService, mockBase64);

        mockConfig = createMockPushConfig();

        mockConfig.notification = createMockNotification({ permission: 'granted', requestPermissionResult: 'granted' });
    });

    describe('initialize', () => {
        it('should initialize correctly with permissions granted', async () => {
            mockConfig.notification = createMockNotification({
                permission: 'granted',
                requestPermissionResult: 'granted',
            });

            await pushService.initialize(mockConfig);

            expect(mockLogger.debug).toHaveBeenCalledWith('[push-service] Notification permission granted.');
            expect(mockConfig.onPermissionGranted).toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith('[push-service] Initialized.');
        });

        it('should handle disablePushService flag', async () => {
            mockConfig.disablePushService = true;

            await pushService.initialize(mockConfig);

            expect(mockLogger.warn).toHaveBeenCalledWith('[push-service] Disabled.');
        });

        it('should handle missing service worker', async () => {
            mockWorkerService = createMockWorkerService({
                registration: mockRegistration,
                container: null,
                controller: mockController,
            });
            pushService = getPushService(mockLogger, mockWorkerService, mockBase64);

            await pushService.initialize(mockConfig);

            expect(mockLogger.warn).toHaveBeenCalledWith('[push-service] Service Worker is not available.');
        });

        it('should handle missing vapid key', async () => {
            mockConfig.vapidKey = undefined;

            await pushService.initialize(mockConfig);

            expect(mockLogger.warn).toHaveBeenCalledWith('[push-service] No vapid key found.');
        });

        it('should handle default notification permission', async () => {
            mockConfig.notification = createMockNotification({
                permission: 'default',
                requestPermissionResult: 'granted',
            });

            await pushService.initialize(mockConfig);

            expect(mockConfig.onPermissionDefault).toHaveBeenCalled();
        });

        it('should handle permission that remains default after requesting', async () => {
            mockConfig.notification = createMockNotification({
                permission: 'default',
                requestPermissionResult: 'default',
            });

            await pushService.initialize(mockConfig);

            expect(mockLogger.error).toHaveBeenCalledWith('[push-service] Notification permission is still default.');
        });

        it('should process push messages from service worker', async () => {
            await pushService.initialize(mockConfig);

            const messageHandler = mockContainer.addEventListener.mock.calls.find(
                ([event]: [any]) => event === 'message',
            )?.[1];
            expect(messageHandler).toBeDefined();

            const mockPayload: CallPayload = {
                a: 'update' as CallMethodName,
                b: 'test-data',
                c: 'signature',
            };
            const mockMessageEvent = {
                data: {
                    type: 'PUSH_NOTIFICATION',
                    payload: { data: mockPayload },
                },
            };

            await messageHandler(mockMessageEvent);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                '[push-service] Message received from Service Worker:',
                expect.anything(),
            );
            expect(mockConfig.onCall).toHaveBeenCalledWith(mockPayload);
        });

        it('should handle invalid payload data', async () => {
            await pushService.initialize(mockConfig);

            const messageHandler = mockContainer.addEventListener.mock.calls.find(
                ([event]: [any]) => event === 'message',
            )?.[1];

            const mockMessageEvent = {
                data: {
                    type: 'PUSH_NOTIFICATION',
                    payload: {},
                },
            };

            await messageHandler(mockMessageEvent);

            expect(mockLogger.error).toHaveBeenCalledWith('[push-service] Invalid payload data.');
        });

        it('should handle missing onCall callback', async () => {
            const configWithoutOnCall = { ...mockConfig } as PushServiceConfig;
            (configWithoutOnCall as any).onCall = undefined;

            await pushService.initialize(configWithoutOnCall as any);

            const messageHandler = mockContainer.addEventListener.mock.calls.find(
                ([event]: [any]) => event === 'message',
            )?.[1];

            const mockMessageEvent = {
                data: {
                    type: 'PUSH_NOTIFICATION',
                    payload: {
                        data: {
                            a: 'update' as CallMethodName,
                            b: 'test-data',
                            c: 'signature',
                        },
                    },
                },
            };

            await messageHandler(mockMessageEvent);

            expect(mockLogger.warn).toHaveBeenCalledWith('[push-service] Message callback is not initialized.');
        });

        it('should handle errors in onCall handler', async () => {
            const error = new Error('Handler error');
            mockConfig.onCall.mockRejectedValueOnce(error);

            await pushService.initialize(mockConfig);

            const messageHandler = mockContainer.addEventListener.mock.calls.find(
                ([event]: [any]) => event === 'message',
            )?.[1];

            const mockPayload: CallPayload = {
                a: 'update' as CallMethodName,
                b: 'test-data',
                c: 'signature',
            };
            const mockMessageEvent = {
                data: {
                    type: 'PUSH_NOTIFICATION',
                    payload: { data: mockPayload },
                },
            };

            await messageHandler(mockMessageEvent);

            expect(mockLogger.error).toHaveBeenCalledWith('[push-service] Error while processing push call.', error);
        });

        it('should handle undefined Notification API', async () => {
            const mockLogger = createMockLogger();
            const mockWorkerService = {
                initialize: vi.fn(),
                get registration() {
                    return { pushManager: {} };
                },
                get container() {
                    return {
                        addEventListener: vi.fn(),
                        removeEventListener: vi.fn(),
                    };
                },
                get controller() {
                    return {};
                },
            } as unknown as WorkerService;
            const mockBase64 = createMockBase64();
            const config = createMockPushConfig({ notification: undefined, pushManager: {} });
            const pushService = getPushService(mockLogger, mockWorkerService, mockBase64);
            await pushService.initialize(config);
            expect(mockLogger.warn).toHaveBeenCalledWith('[push-service] Notifications are not supported.');
        });

        it('should call onPermissionDenied if permission is denied', async () => {
            const mockLogger = createMockLogger();
            const mockOnPermissionDenied = vi.fn().mockResolvedValue(undefined);
            const config = createMockPushConfig({
                notification: createMockNotification({ permission: 'denied', requestPermissionResult: 'denied' }),
                onPermissionDenied: mockOnPermissionDenied,
            });
            const pushService = getPushService(mockLogger, mockWorkerService as WorkerService, createMockBase64());
            await pushService.initialize(config);
            expect(mockLogger.error).toHaveBeenCalledWith('[push-service] Notification permission denied.');
            expect(mockOnPermissionDenied).toHaveBeenCalled();
        });
    });

    describe('getSubscription', () => {
        beforeEach(async () => {
            mockConfig.notification = createMockNotification({ permission: 'granted' });

            const mockPushManagerClass = {} as unknown as typeof PushManager;
            mockConfig.pushManager = mockPushManagerClass;

            await pushService.initialize(mockConfig);
            vi.clearAllMocks();
        });

        it('should return a valid subscription', async () => {
            mockPushSubscription = {
                endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
                expirationTime: null,
                options: {
                    applicationServerKey: new Uint8Array([1, 2, 3]),
                },
                getKey: vi.fn().mockImplementation((key) => {
                    if (key === 'p256dh') return new Uint8Array([4, 5, 6]);
                    if (key === 'auth') return new Uint8Array([7, 8, 9]);
                    return null;
                }),
                unsubscribe: vi.fn().mockResolvedValue(true),
            };

            mockConfig.vapidKey = TEST_EPHEMON_VAPID_KEY;

            mockPushManager.getSubscription.mockResolvedValue(mockPushSubscription);
            mockPushManager.subscribe.mockResolvedValue(mockPushSubscription);

            const result = await pushService.getSubscription();

            expect(result).toEqual({
                endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
                expirationTime: null,
                keys: {
                    p256dh: 'encoded-4',
                    auth: 'encoded-7',
                },
            });
            expect(mockLogger.debug).toHaveBeenCalledWith(
                '[push-service] Subscription:',
                expect.stringContaining('https://fcm.googleapis.com/fcm/send/test-endpoint'),
            );
        });

        it('should warn if urlBase64ToUint8Array is missing in getSubscription', async () => {
            const config = createMockPushConfig({ pushManager: {}, urlBase64ToUint8Array: undefined });
            await pushService.initialize(config);
            const result = await pushService.getSubscription();
            expect(result).toBeUndefined();
            expect(mockLogger.warn).toHaveBeenCalledWith('[push-service] UrlBase64ToUint8Array is not initialized.');
        });

        it('should warn if subscription endpoint is missing in getSubscription', async () => {
            const logger = createMockLogger();
            const pushSubscription = createMockPushSubscription({ endpoint: undefined });
            const pushManager = createMockPushManager({}, pushSubscription);
            const registration = { pushManager, scope: 'scope' };
            const container = createMockServiceWorkerContainer({}, registration);
            const workerService = createMockWorkerService({
                registration,
                container,
                controller: container.controller,
            });
            const base64 = createMockBase64();
            const config = createMockPushConfig({
                pushManager,
                urlBase64ToUint8Array: (base64String: string) => new Uint8Array([1, 2, 3]),
            });
            const pushService = getPushService(logger, workerService, base64);
            await pushService.initialize(config);
            const result = await pushService.getSubscription();
            expect(result).toBeUndefined();
            expect(logger.warn).toHaveBeenCalledWith('[push-service] Invalid subscription endpoint.');
        });

        it('should warn if p256dh key is invalid in getSubscription', async () => {
            const logger = createMockLogger();
            const pushSubscription = createMockPushSubscription({
                endpoint: 'test-endpoint',
                getKey: vi.fn().mockImplementation((key) => (key === 'p256dh' ? null : new Uint8Array([1, 2, 3]))),
            });
            const pushManager = createMockPushManager({}, pushSubscription);
            const registration = { pushManager, scope: 'scope' };
            const container = createMockServiceWorkerContainer({}, registration);
            const workerService = createMockWorkerService({
                registration,
                container,
                controller: container.controller,
            });
            const base64 = createMockBase64();
            const config = createMockPushConfig({
                pushManager,
                urlBase64ToUint8Array: (base64String: string) => new Uint8Array([1, 2, 3]),
            });
            const pushService = getPushService(logger, workerService, base64);
            await pushService.initialize(config);
            const result = await pushService.getSubscription();
            expect(result).toBeUndefined();
            expect(logger.warn).toHaveBeenCalledWith('[push-service] Invalid p256dh key.');
        });

        it('should warn if auth key is invalid in getSubscription', async () => {
            const logger = createMockLogger();
            const pushSubscription = createMockPushSubscription({
                endpoint: 'test-endpoint',
                getKey: vi.fn().mockImplementation((key) => (key === 'auth' ? null : new Uint8Array([1, 2, 3]))),
            });
            const pushManager = createMockPushManager({}, pushSubscription);
            const registration = { pushManager, scope: 'scope' };
            const container = createMockServiceWorkerContainer({}, registration);
            const workerService = createMockWorkerService({
                registration,
                container,
                controller: container.controller,
            });
            const base64 = createMockBase64();
            const config = createMockPushConfig({
                pushManager,
                urlBase64ToUint8Array: (base64String: string) => new Uint8Array([1, 2, 3]),
            });
            const pushService = getPushService(logger, workerService, base64);
            await pushService.initialize(config);
            const result = await pushService.getSubscription();
            expect(result).toBeUndefined();
            expect(logger.warn).toHaveBeenCalledWith('[push-service] Invalid auth key.');
        });

        it('should log error if pushManager.subscribe throws in getSubscription', async () => {
            const logger = createMockLogger();
            const error = new Error('subscribe failed');
            const pushSubscription = createMockPushSubscription({ endpoint: 'test-endpoint' });
            const pushManager = createMockPushManager(
                {
                    getSubscription: vi.fn().mockResolvedValue(undefined),
                    subscribe: vi.fn().mockRejectedValue(error),
                },
                pushSubscription,
            );
            const registration = { pushManager, scope: 'scope' };
            const container = createMockServiceWorkerContainer({}, registration);
            const workerService = createMockWorkerService({
                registration,
                container,
                controller: container.controller,
            });
            const base64 = createMockBase64();
            const config = createMockPushConfig({
                pushManager,
                urlBase64ToUint8Array: (base64String: string) => new Uint8Array([1, 2, 3]),
            });
            const pushService = getPushService(logger, workerService, base64);
            await pushService.initialize(config);
            const result = await pushService.getSubscription();
            expect(result).toBeUndefined();
            expect(logger.error).toHaveBeenCalledWith(
                '[push-service] An error occurred while obtaining the subscription.',
                error,
            );
        });

        it('should log error if unsubscribe throws in getSubscription', async () => {
            const mockLogger = createMockLogger();
            const unsubscribeError = new Error('unsubscribe failed');
            const mockPushSubscription = {
                endpoint: 'test-endpoint',
                expirationTime: null,
                options: { applicationServerKey: new Uint8Array([9, 9, 9]) },
                getKey: vi.fn().mockImplementation((key) => new Uint8Array([1, 2, 3])),
                unsubscribe: vi.fn().mockRejectedValue(unsubscribeError),
            };
            const mockPushManager = {
                getSubscription: vi.fn().mockResolvedValue(mockPushSubscription),
                subscribe: vi.fn().mockResolvedValue(mockPushSubscription),
            };
            const mockRegistration = { pushManager: mockPushManager, scope: 'scope' };
            const mockContainer = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
                controller: { postMessage: vi.fn() },
            };
            const mockWorkerService = {
                initialize: vi.fn(),
                get registration() {
                    return mockRegistration;
                },
                get container() {
                    return mockContainer;
                },
                get controller() {
                    return mockContainer.controller;
                },
            } as unknown as WorkerService;
            const mockBase64 = createMockBase64({ '9,9,9': 'key1', '1,2,3': 'key2' });
            const config = createMockPushConfig({
                pushManager: mockPushManager,
                urlBase64ToUint8Array: (base64String: string) => new Uint8Array([1, 2, 3]),
            });
            const pushService = getPushService(mockLogger, mockWorkerService, mockBase64);
            await pushService.initialize(config);
            await pushService.getSubscription();
            expect(mockPushSubscription.unsubscribe).toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(
                '[push-service] An error occurred while cancelling the subscription.',
                unsubscribeError,
            );
        });
    });

    describe('getSubscription denied permissions', () => {
        it('should handle denied notification permission', async () => {
            const mockLogger = createMockLogger();

            const mockContainer = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            };

            const mockWorkerService = {
                initialize: vi.fn(),
                get registration() {
                    return { pushManager: {} };
                },
                get container() {
                    return mockContainer;
                },
                get controller() {
                    return {};
                },
            } as unknown as WorkerService;

            const mockBase64 = {
                encode: vi.fn(),
                decode: vi.fn(),
            };

            const mockConfig = {
                vapidKey: 'test-vapid-key',
                onCall: vi.fn().mockResolvedValue(undefined),
                notification: createMockNotification({ permission: 'denied' }),
            };

            const pushService = getPushService(mockLogger, mockWorkerService as WorkerService, mockBase64);

            await pushService.initialize(mockConfig);

            vi.clearAllMocks();

            const result = await pushService.getSubscription();

            expect(result).toBeUndefined();
            expect(mockLogger.warn).toHaveBeenCalledWith('[push-service] Notification permission was not granted.');
        });
    });

    describe('getSubscription undefined APIs', () => {
        it('should handle undefined PushManager API', async () => {
            const mockNotification = createMockNotification({ permission: 'granted' });

            const pushService = getPushService(mockLogger, mockWorkerService as unknown as WorkerService, mockBase64);

            await pushService.initialize({
                ...mockConfig,
                notification: mockNotification,
                pushManager: undefined,
            });

            vi.clearAllMocks();

            const result = await pushService.getSubscription();

            expect(result).toBeUndefined();
            expect(mockLogger.warn).toHaveBeenCalledWith('[push-service] PushManager is not available.');
        });

        it('should handle undefined Notification API in getSubscription', async () => {
            const mockLogger = createMockLogger();

            const mockContainer = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            };

            const mockWorkerService = {
                initialize: vi.fn(),
                get registration() {
                    return { pushManager: {} };
                },
                get container() {
                    return mockContainer;
                },
                get controller() {
                    return null;
                },
            } as unknown as WorkerService;

            const mockBase64 = {
                encode: vi.fn(),
                decode: vi.fn(),
            };

            const mockConfig = {
                vapidKey: 'test-vapid-key',
                onCall: vi.fn().mockResolvedValue(undefined),
                notification: undefined,
            };

            const pushService = getPushService(mockLogger, mockWorkerService, mockBase64);

            await pushService.initialize(mockConfig);

            vi.clearAllMocks();

            const result = await pushService.getSubscription();

            expect(result).toBeUndefined();
        });
    });

    describe('showNotification tests', () => {
        it('should handle missing controller', async () => {
            const mockLogger = createMockLogger();

            const mockContainer = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            };

            const mockWorkerService = {
                initialize: vi.fn(),
                get registration() {
                    return { pushManager: {} };
                },
                get container() {
                    return mockContainer;
                },
                get controller() {
                    return null;
                },
            } as unknown as WorkerService;

            const mockBase64 = {
                encode: vi.fn(),
                decode: vi.fn(),
            };

            const mockConfig = {
                vapidKey: 'test-vapid-key',
                onCall: vi.fn().mockResolvedValue(undefined),
                notification: createMockNotification({ permission: 'granted', asConstructor: true }),
            };

            const pushService = getPushService(mockLogger, mockWorkerService as WorkerService, mockBase64);

            await pushService.initialize(mockConfig);

            (pushService as any).subscription = {
                endpoint: 'test-endpoint',
                expirationTime: null,
                keys: { p256dh: 'key1', auth: 'key2' },
            };

            vi.clearAllMocks();

            const result = pushService.showNotification('Test notification', { body: 'Test body' });

            expect(result).toBe(true);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                '[push-service] Unable to show notification. Service worker is not initialized.',
            );
            expect((mockConfig.notification as any).calls[0][0]).toBe('Test notification');
            expect((mockConfig.notification as any).calls[0][1]).toEqual({ body: 'Test body' });
        });

        it('should handle missing subscription', async () => {
            const mockLogger = createMockLogger();

            const mockController = {
                postMessage: vi.fn(),
            };

            const mockContainer = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            };

            const mockWorkerService = {
                initialize: vi.fn(),
                get registration() {
                    return { pushManager: {} };
                },
                get container() {
                    return mockContainer;
                },
                get controller() {
                    return mockController;
                },
            } as unknown as WorkerService;

            const mockBase64 = {
                encode: vi.fn(),
                decode: vi.fn(),
            };

            const mockConfig = {
                vapidKey: 'test-vapid-key',
                onCall: vi.fn().mockResolvedValue(undefined),
                notification: createMockNotification({ permission: 'granted', asConstructor: true }),
            };

            const pushService = getPushService(mockLogger, mockWorkerService as WorkerService, mockBase64);

            await pushService.initialize(mockConfig);

            const result = pushService.showNotification('Test notification', { body: 'Test body' });

            expect(result).toBe(true);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                '[push-service] Unable to show notification. Notifications unavailable.',
            );
            expect((mockConfig.notification as any).calls[0][0]).toBe('Test notification');
            expect((mockConfig.notification as any).calls[0][1]).toEqual({ body: 'Test body' });
        });
    });

    it('should log debug if unsubscribe succeeds in getPushSubscription (applicationServerKey changed)', async () => {
        const mockLogger = createMockLogger();
        const mockPushSubscription = {
            endpoint: 'endpoint',
            expirationTime: null,
            options: { applicationServerKey: new Uint8Array([9, 9, 9]) },
            getKey: vi.fn().mockImplementation((key) => {
                if (key === 'p256dh') return new Uint8Array([4, 5, 6]);
                if (key === 'auth') return new Uint8Array([7, 8, 9]);
                return null;
            }),
            unsubscribe: vi.fn().mockResolvedValue(true),
        };
        const mockPushManager = {
            getSubscription: vi.fn().mockResolvedValue(mockPushSubscription),
            subscribe: vi.fn().mockResolvedValue(mockPushSubscription),
        };
        const mockRegistration = { pushManager: mockPushManager, scope: 'scope' };
        const mockContainer = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
            controller: { postMessage: vi.fn() },
        };
        const mockWorkerService = {
            initialize: vi.fn(),
            get registration() {
                return mockRegistration;
            },
            get container() {
                return mockContainer;
            },
            get controller() {
                return mockContainer.controller;
            },
        } as unknown as WorkerService;
        const mockBase64 = {
            encode: vi.fn((input) => {
                if (input[0] === 9) return 'key1';
                if (input[0] === 1) return 'key2';
                return 'other';
            }),
            decode: vi.fn(),
        };
        const config = createMockPushConfig({
            pushManager: mockPushManager,
            urlBase64ToUint8Array: (base64String: string) => new Uint8Array([1, 2, 3]),
        });
        const pushService = getPushService(mockLogger, mockWorkerService, mockBase64);
        await pushService.initialize(config);
        await pushService.getSubscription();
        expect(mockBase64.encode).toHaveBeenCalledWith(new Uint8Array([9, 9, 9]));
        expect(mockBase64.encode).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
        expect(mockPushSubscription.unsubscribe).toHaveBeenCalled();
        expect(mockLogger.debug).toHaveBeenCalledWith('[push-service] Unsubscribed.');
    });

    it('should warn if registration is missing in getPushSubscription', async () => {
        mockWorkerService = createMockWorkerService({
            registration: undefined,
            container: mockContainer,
            controller: mockController,
        });
        pushService = getPushService(mockLogger, mockWorkerService, mockBase64);
        await pushService.initialize(mockConfig);
        const result = await pushService.getSubscription();
        expect(result).toBeUndefined();
        expect(mockLogger.warn).toHaveBeenCalledWith('[push-service] Service Worker registration is not available.');
    });

    it('should warn if vapidKey is missing in getPushSubscription', async () => {
        const config = createMockPushConfig({
            vapidKey: undefined,
            urlBase64ToUint8Array: (base64String: string) => new Uint8Array([1, 2, 3]),
            pushManager: {},
        });
        await pushService.initialize(config);
        const result = await pushService.getSubscription();
        expect(result).toBeUndefined();
        expect(mockLogger.warn).toHaveBeenCalledWith('[push-service] Vapid Key is not initialized.');
    });

    it('should call postMessage and return true in showNotification when all present', async () => {
        const mockController = { postMessage: vi.fn() };
        const mockWorkerService = {
            initialize: vi.fn(),
            get registration() {
                return { pushManager: mockPushManager };
            },
            get container() {
                return {
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                };
            },
            get controller() {
                return mockController;
            },
        } as unknown as WorkerService;
        const pushService = getPushService(mockLogger, mockWorkerService, mockBase64);
        const config = createMockPushConfig({ pushManager: mockPushManager });
        await pushService.initialize(config);
        await pushService.getSubscription();
        const result = pushService.showNotification('Title', { body: 'Body' });
        expect(result).toBe(true);
        expect(mockController.postMessage).toHaveBeenCalledWith({
            type: 'SHOW_NOTIFICATION',
            title: 'Title',
            options: { body: 'Body' },
        });
    });

    it('should return false in showNotification fallback if Notification is missing', async () => {
        await pushService.initialize({ ...mockConfig, notification: undefined });
        (pushService as any).subscription = undefined;
        mockWorkerService = createMockWorkerService({
            registration: mockRegistration,
            container: mockContainer,
            controller: undefined,
        });
        pushService = getPushService(mockLogger, mockWorkerService, mockBase64);
        const result = pushService.showNotification('NoNotif', { body: 'none' });
        expect(result).toBe(false);
    });

    describe('processMessage edge cases', () => {
        it('should log error if payload has no data', async () => {
            const mockLogger = createMockLogger();
            const mockContainer = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
                controller: { postMessage: vi.fn() },
            };
            const mockWorkerService = {
                initialize: vi.fn(),
                get registration() {
                    return { pushManager: {} };
                },
                get container() {
                    return mockContainer;
                },
                get controller() {
                    return mockContainer.controller;
                },
            } as unknown as WorkerService;
            const mockBase64 = createMockBase64();
            const config = createMockPushConfig();
            const pushService = getPushService(mockLogger, mockWorkerService, mockBase64);
            await pushService.initialize(config);
            const handler = mockContainer.addEventListener.mock.calls.find((call) => call[0] === 'message')?.[1];
            expect(handler).toBeDefined();
            await (handler as Function)({ data: { type: 'PUSH_NOTIFICATION', payload: {} } });
            expect(mockLogger.error).toHaveBeenCalledWith('[push-service] Invalid payload data.');
        });

        it('should log error if payload.data is missing field a', async () => {
            const mockLogger = createMockLogger();
            const mockContainer = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
                controller: { postMessage: vi.fn() },
            };
            const mockWorkerService = {
                initialize: vi.fn(),
                get registration() {
                    return { pushManager: {} };
                },
                get container() {
                    return mockContainer;
                },
                get controller() {
                    return mockContainer.controller;
                },
            } as unknown as WorkerService;
            const mockBase64 = createMockBase64();
            const config = createMockPushConfig();
            const pushService = getPushService(mockLogger, mockWorkerService, mockBase64);
            await pushService.initialize(config);
            const handler = mockContainer.addEventListener.mock.calls.find((call) => call[0] === 'message')?.[1];
            expect(handler).toBeDefined();
            await (handler as Function)({ data: { type: 'PUSH_NOTIFICATION', payload: { data: { b: 123 } } } });
            expect(mockLogger.error).toHaveBeenCalledWith('[push-service] Invalid payload data.');
        });
    });

    it('should handle invalid payload with no required property and log error', async () => {
        await pushService.initialize(mockConfig);
        const container = mockWorkerService.container!;
        const handler = (container.addEventListener as Mock).mock.calls.find(([event]) => event === 'message')?.[1];
        expect(handler).toBeDefined();
        await (handler as Function)({
            data: {
                type: 'PUSH_NOTIFICATION',
                payload: { data: {} },
            },
        });
        expect(mockLogger.error).toHaveBeenCalledWith('[push-service] Invalid payload data.');
    });

    it('should fall back to Notification constructor when showInternal fails and Notification is defined', async () => {
        const MockNotification = createMockNotification({ asConstructor: true });
        mockConfig.notification = MockNotification;
        pushService = getPushService(mockLogger, mockWorkerService, mockBase64);
        await pushService.initialize(mockConfig);
        const result = pushService.showNotification('Test title', { body: 'Test body' });
        expect(MockNotification.calls).toEqual([['Test title', { body: 'Test body' }]]);
        expect(result).toBe(true);
    });

    it('should ignore non-push message events', async () => {
        await pushService.initialize(mockConfig);
        const container = mockWorkerService.container!;
        const handler = (container.addEventListener as Mock).mock.calls.find((call) => call[0] === 'message')?.[1];
        expect(handler).toBeDefined();
        await (handler as Function)({});
        await (handler as Function)({ data: { type: 'OTHER', payload: { data: { a: 'update', b: '', c: '' } } } });
        expect(mockConfig.onCall).not.toHaveBeenCalled();
    });

    it('should skip onPermissionDefault when not provided and permission remains default', async () => {
        const defaultNotification = createMockNotification({
            permission: 'default',
            requestPermissionResult: 'default',
        });
        mockConfig.notification = defaultNotification;
        delete mockConfig.onPermissionDefault;
        await pushService.initialize(mockConfig);
        expect(defaultNotification.requestPermission).toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalledWith('[push-service] Notification permission is still default.');
    });
});

describe('urlBase64ToUint8Array', () => {
    it('should decode a standard base64 string', () => {
        const arr = urlBase64ToUint8Array('AQID');
        expect(arr).toBeInstanceOf(Uint8Array);
        expect(Array.from(arr)).toEqual([1, 2, 3]);
    });
    it('should decode a url-safe base64 string', () => {
        const arr = urlBase64ToUint8Array('AQID-_8');
        expect(Array.from(arr)).toEqual([1, 2, 3, 251, 255]);
    });
    it('should handle missing padding', () => {
        const arr = urlBase64ToUint8Array('AQID');
        expect(Array.from(arr)).toEqual([1, 2, 3]);
    });
});
