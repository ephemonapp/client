import type { WorkerService } from '../src/services/worker-service';

interface MockRTCDataChannel {
    id: string;
    label: string;
    readyState: string;
    onopen: Mock;
    onmessage: Mock;
    close: Mock;
    send: Mock;
}

interface MockRTCPeerConnection {
    createDataChannel: Mock;
    createOffer: Mock;
    createAnswer: Mock;
    setLocalDescription: Mock;
    setRemoteDescription: Mock;
    addIceCandidate: Mock;
    onicecandidate: Mock;
    ondatachannel: Mock;
    onconnectionstatechange: Mock;
    close: Mock;
    getStats: Mock;
    remoteDescription: any;
}

export function createMockLogger() {
    return {
        trace: vi.fn(),
        debug: vi.fn(),
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
}

export function createMockTimeService() {
    return {
        get serverTime() {
            return 123456789;
        },
        set serverTime(_value: number) {},
        onSync: vi.fn(),
    };
}

export function createMockSessionService() {
    return {
        initialize: vi.fn(),
        get signingKeyPair() {
            return { publicKey: new Uint8Array([1, 2, 3]), secretKey: new Uint8Array([4, 5, 6]) };
        },
        get signingPublicKeyBase64() {
            return 'abc123';
        },
        get signingPublicKeyBase64Safe() {
            return 'abc123';
        },
    };
}

export function createMockBase64(arg: any = {}) {
    if (typeof arg === 'object' && arg !== null && !('encode' in arg) && !('decode' in arg)) {
        const encodeMap = arg;
        return {
            encode: vi.fn((data: Uint8Array) => {
                const key = Array.from(data).join(',');
                if (encodeMap[key]) return encodeMap[key];
                return 'encoded-data';
            }),
            decode: vi.fn(),
        };
    }
    return {
        encode: arg.encode || vi.fn((data: Uint8Array) => 'encoded-data'),
        decode: arg.decode || vi.fn(),
    };
}

export function createMockUtf8({ encode, decode }: { encode?: any; decode?: any } = {}) {
    return {
        encode: encode || vi.fn(),
        decode: decode || vi.fn().mockReturnValue(new Uint8Array([7, 8, 9])),
    };
}

export function createMockCryptography(
    overrides: Partial<{
        generateEncryptionKeyPair: () => any;
        generateSharedSymmetricKey: () => any;
        encrypt: (data: any) => any;
        decrypt: (data: any) => any;
        sign: () => any;
        verifySignature: () => any;
        generateSigningKeyPair: () => any;
    }> = {},
) {
    return {
        generateEncryptionKeyPair:
            overrides.generateEncryptionKeyPair ||
            vi.fn(() => ({
                publicKey: new Uint8Array([1, 2, 3]),
                secretKey: new Uint8Array([4, 5, 6]),
            })),
        generateSharedSymmetricKey: overrides.generateSharedSymmetricKey || vi.fn(() => new Uint8Array([7, 8, 9])),
        encrypt: overrides.encrypt || vi.fn((data) => data),
        decrypt: overrides.decrypt || vi.fn((data) => data),
        sign: overrides.sign || vi.fn(() => new Uint8Array([10, 11, 12])),
        verifySignature: overrides.verifySignature || vi.fn(() => true),
        generateSigningKeyPair:
            overrides.generateSigningKeyPair ||
            vi.fn(() => ({
                publicKey: new Uint8Array([13, 14, 15]),
                secretKey: new Uint8Array([16, 17, 18]),
            })),
    };
}

export function createMockCallService() {
    return {
        initialize: vi.fn(),
        update: vi.fn(),
        dial: vi.fn(),
        offer: vi.fn(),
        answer: vi.fn(),
        ice: vi.fn(),
        close: vi.fn(),
    };
}

export const TEST_PRIME_SERVER_URL = 'https://prime.ephemon.test';

export function createMockCallServiceFactory(prime: any = createMockCallService(), overrides: any = {}) {
    return {
        initialize: vi.fn(),
        get prime() {
            return prime;
        },
        get primeServerUrl() {
            return TEST_PRIME_SERVER_URL;
        },
        getForServerUrl: vi.fn(async () => prime),
        ...overrides,
    };
}

export function createMockPushConfig(overrides = {}) {
    const TEST_EPHEMON_VAPID_KEY =
        'BDuixZ_tK0mDQPXYYuT1zWcql3BKy_y_dJmUVd9M5hTpCkE-BCvqeXGKyKqX2YRxLQIw1x_SZTHxY7MNwUx4hI0';
    const notificationMock = vi.fn() as unknown as typeof Notification;
    (notificationMock as any).permission = 'granted';
    notificationMock.requestPermission = vi.fn().mockResolvedValue('granted');
    const basePushManager = {
        getSubscription: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockResolvedValue(undefined),
    } as unknown as typeof PushManager;
    return {
        vapidKey: TEST_EPHEMON_VAPID_KEY,
        onCall: vi.fn().mockResolvedValue(undefined),
        onPermissionDefault: vi.fn().mockResolvedValue(undefined),
        onPermissionGranted: vi.fn().mockResolvedValue(undefined),
        onPermissionDenied: vi.fn().mockResolvedValue(undefined),
        notification: notificationMock,
        urlBase64ToUint8Array: () => new Uint8Array([1, 2, 3]),
        pushManager: basePushManager,
        ...overrides,
    };
}

export function createMockWebRTC(): any {
    class MockPeerConnection {
        static generateCertificate = vi.fn().mockResolvedValue({});

        constructor(_config?: any) {}
    }

    return {
        PeerConnection: MockPeerConnection as any,
        DataChannel: vi.fn() as any,
    };
}

export function createMockDialCallHandler() {
    return {
        initialize: vi.fn(),
        parse: vi.fn(),
        validate: vi.fn(),
        handle: vi.fn(),
    };
}

export function createMockOfferCallHandler() {
    return {
        parse: vi.fn(),
        validate: vi.fn(),
        handle: vi.fn(),
    };
}

export function createMockAnswerCallHandler() {
    return {
        parse: vi.fn(),
        validate: vi.fn(),
        handle: vi.fn(),
    };
}

export function createMockIceCallHandler() {
    return {
        parse: vi.fn(),
        validate: vi.fn(),
        handle: vi.fn(),
    };
}

export function createMockCloseCallHandler() {
    return {
        parse: vi.fn(),
        validate: vi.fn(),
        handle: vi.fn(),
    };
}

export function createMockWorkerService({
    registration,
    container,
    controller,
}: {
    registration?: any;
    container?: any;
    controller?: any;
} = {}): WorkerService {
    return {
        async initialize(_config: any) {
            return;
        },
        get registration() {
            return registration;
        },
        get container() {
            return container;
        },
        get controller() {
            return controller;
        },
    };
}

export function createMockServiceWorker({
    register = vi.fn(),
    ready = Promise.resolve({ scope: 'http://localhost/' }),
    addEventListener = vi.fn(),
    controller = { state: 'activated' },
} = {}) {
    return {
        register,
        ready,
        addEventListener,
        controller,
    };
}

export function createMockNotification({
    permission = 'granted',
    requestPermissionResult = 'granted',
    asConstructor = false,
} = {}) {
    if (asConstructor) {
        // @ts-ignore
        function MockNotification(this: any, ...args: any[]) {
            MockNotification.calls.push(args);
        }

        MockNotification.calls = [] as any[];
        (MockNotification as any).permission = permission;
        (MockNotification as any).requestPermission = vi.fn().mockResolvedValue(requestPermissionResult);
        return MockNotification as any;
    }
    return {
        permission,
        requestPermission: vi.fn().mockResolvedValue(requestPermissionResult),
    } as any;
}

export function mockDateNow(value: number) {
    Date.now = vi.fn().mockReturnValue(value);
}

export function restoreDateNow(original: typeof Date.now) {
    Date.now = original;
}

export function mockEphemonCoreServices() {
    const callServiceMock = {
        initialize: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
    };
    const connectionServiceMock = {
        initialize: vi.fn(),
        connections: [] as any[],
        getConnection: vi.fn(),
        createOutgoing: vi.fn(),
        deleteConnection: vi.fn(),
    };
    const handleServiceMock = {
        initialize: vi.fn(),
        call: vi.fn(),
    };
    const pushServiceMock = {
        initialize: vi.fn().mockResolvedValue(undefined),
        getSubscription: vi
            .fn()
            .mockResolvedValue({ endpoint: 'test-endpoint', keys: { p256dh: 'key1', auth: 'key2' } }),
        showNotification: vi.fn().mockReturnValue(true),
    };
    const sessionServiceMock = {
        initialize: vi.fn().mockResolvedValue(undefined),
        signingKeyPair: {} as any,
        signingPublicKeyBase64: 'test-public-key',
        signingPublicKeyBase64Safe: 'test-public-key-safe',
    };
    const signalRServiceMock = {
        initialize: vi.fn().mockImplementation(async (config) => {
            if (config.onReady) {
                await config.onReady();
            }
        }),
    };
    const workerServiceMock = {
        initialize: vi.fn().mockResolvedValue(undefined),
        controller: {
            postMessage: vi.fn(),
        },
    };
    const timeServiceMock = {
        serverTime: 12345,
        onSync: vi.fn(),
    };
    const translateConnectionMock = vi.fn((conn) =>
        conn ? { publicKey: conn.publicKey || 'mock-key', state: conn.state || 0 } : conn,
    );
    const cryptographyMock = {
        generateSigningKeyPair: vi.fn().mockReturnValue({
            publicKey: new Uint8Array(),
            secretKey: new Uint8Array(),
        }),
    };
    vi.doMock('../src/services/call-service', () => ({
        getCallService: vi.fn(() => callServiceMock),
    }));
    vi.doMock('../src/services/connection-service', () => ({
        getConnectionService: vi.fn(() => connectionServiceMock),
    }));
    vi.doMock('../src/services/handle-service', () => ({
        getHandleService: vi.fn(() => handleServiceMock),
    }));
    vi.doMock('../src/services/push-service', () => ({
        getPushService: vi.fn(() => pushServiceMock),
    }));
    vi.doMock('../src/services/session-service', () => ({
        getSessionService: vi.fn(() => sessionServiceMock),
    }));
    vi.doMock('../src/services/signalr-service', () => ({
        getSignalRService: vi.fn(() => signalRServiceMock),
    }));
    vi.doMock('../src/services/worker-service', () => ({
        getWorkerService: vi.fn(() => workerServiceMock),
    }));
    vi.doMock('../src/services/time-service', () => ({
        getTimeService: vi.fn(() => timeServiceMock),
    }));
    vi.doMock('../src/services/connection/connection', async (importOriginal) => {
        const original = await importOriginal<typeof import('../src/services/connection/connection')>();
        return {
            ...original,
            translateConnection: translateConnectionMock,
        };
    });

    vi.doMock('../src/utils/api-client', () => ({
        getApiClient: vi.fn().mockReturnValue({}),
    }));
    vi.doMock('../src/utils/base64', () => ({
        getBase64: vi.fn().mockReturnValue({}),
    }));
    vi.doMock('../src/utils/cryptography', () => ({
        getCryptography: vi.fn().mockReturnValue(cryptographyMock),
    }));
    vi.doMock('../src/utils/utf8', () => ({
        getUtf8: vi.fn().mockReturnValue({}),
    }));

    return {
        callServiceMock,
        connectionServiceMock,
        cryptographyMock,
        handleServiceMock,
        pushServiceMock,
        sessionServiceMock,
        signalRServiceMock,
        timeServiceMock,
        translateConnectionMock,
        workerServiceMock,
    };
}

export function setupEphemonBrowserMocks() {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    (global as any).RTCPeerConnection = vi.fn();
    (global as any).RTCDataChannel = vi.fn();
    (global as any).window = {
        Notification: vi.fn(),
        PushManager: vi.fn(),
        urlBase64ToUint8Array: vi.fn(() => new Uint8Array([1, 2, 3])),
    };
}

export function teardownEphemonBrowserMocks() {
    vi.useRealTimers();
    delete (global as any).RTCPeerConnection;
    delete (global as any).RTCDataChannel;
    delete (global as any).window;
}

export function createMockNavigator({ serviceWorker, sendBeacon }: Partial<Navigator & { sendBeacon?: any }> = {}) {
    const nav: any = {};
    if (serviceWorker !== undefined) nav.serviceWorker = serviceWorker;
    if (sendBeacon !== undefined) nav.sendBeacon = sendBeacon;
    return nav;
}

export function createMockPushSubscription(overrides: Partial<PushSubscription> = {}): PushSubscription {
    return {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
        expirationTime: null,
        options: { applicationServerKey: new Uint8Array([1, 2, 3]) },
        getKey: vi.fn().mockImplementation((key) => {
            if (key === 'p256dh') return new Uint8Array([4, 5, 6]);
            if (key === 'auth') return new Uint8Array([7, 8, 9]);
            return null;
        }),
        unsubscribe: vi.fn().mockResolvedValue(true),
        ...overrides,
    } as unknown as PushSubscription;
}

export function createMockPushManager(
    overrides: Partial<PushManager> = {},
    subscription?: PushSubscription,
): PushManager {
    const mockSubscription = subscription || createMockPushSubscription();
    return {
        getSubscription: vi.fn().mockResolvedValue(mockSubscription),
        subscribe: vi.fn().mockResolvedValue(mockSubscription),
        ...overrides,
    } as unknown as PushManager;
}

export function createMockServiceWorkerContainer(
    overrides: Partial<ServiceWorkerContainer> = {},
    registration?: any,
    controller?: any,
): ServiceWorkerContainer {
    const eventListeners: Record<string, Function[]> = {};
    return {
        addEventListener: vi.fn().mockImplementation((event, handler) => {
            if (!eventListeners[event]) eventListeners[event] = [];
            eventListeners[event].push(handler);
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        controller: controller || { postMessage: vi.fn() },
        oncontrollerchange: null,
        onmessage: null,
        onmessageerror: null,
        ready: Promise.resolve(registration),
        getRegistration: vi.fn(),
        getRegistrations: vi.fn(),
        register: vi.fn(),
        startMessages: vi.fn(),
        ...overrides,
    } as unknown as ServiceWorkerContainer;
}

export function createMockConnection(overrides: Partial<any> = {}) {
    return {
        publicKey: 'test-public-key',
        state: 'new',
        close: vi.fn(),
        ...overrides,
    };
}

export function createMockDataChannel(overrides: Partial<MockRTCDataChannel> = {}): MockRTCDataChannel {
    return {
        id: 'data-channel-id',
        label: 'mock-data-channel',
        readyState: 'connecting',
        onopen: vi.fn(),
        onmessage: vi.fn(),
        close: vi.fn(),
        send: vi.fn(),
        ...overrides,
    };
}

export function createMockPeerConnection(
    overrides: Partial<MockRTCPeerConnection> = {},
    mockDataChannel?: MockRTCDataChannel,
): MockRTCPeerConnection {
    return {
        createDataChannel: vi.fn(() => mockDataChannel || createMockDataChannel()),
        createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' }),
        createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp' }),
        setLocalDescription: vi.fn().mockResolvedValue(undefined),
        setRemoteDescription: vi.fn().mockResolvedValue(undefined),
        addIceCandidate: vi.fn().mockResolvedValue(undefined),
        onicecandidate: vi.fn(),
        ondatachannel: vi.fn(),
        onconnectionstatechange: vi.fn(),
        close: vi.fn(),
        getStats: vi.fn().mockResolvedValue(
            new Map([
                [
                    'candidate-pair-id',
                    {
                        type: 'candidate-pair',
                        selected: true,
                        localCandidateId: 'local-candidate-id',
                    },
                ],
                [
                    'local-candidate-id',
                    {
                        candidateType: 'host',
                        address: '192.168.1.1',
                    },
                ],
            ]),
        ),
        remoteDescription: null,
        ...overrides,
    };
}

export function createMockKeyPair(overrides = {}) {
    return {
        publicKey: new Uint8Array([1, 2, 3]),
        secretKey: new Uint8Array([4, 5, 6]),
        ...overrides,
    };
}

export function createMockEphemonConfig(overrides = {}) {
    return {
        serverUrl: 'https://test-server.com',
        onCall: vi.fn(),
        onReady: vi.fn(),
        focusOnDial: vi.fn(),
        requestDial: vi.fn(),
        version: '1.0.0',
        signingKeyPair: createMockKeyPair(),
        vapidKey: 'test-vapid-key',
        iceServers: [{ urls: 'stun:test.com' }],
        navigator: { serviceWorker: {} },
        ...overrides,
    };
}
