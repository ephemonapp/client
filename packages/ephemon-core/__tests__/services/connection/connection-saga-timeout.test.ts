import { ConnectionSagaState, getConnectionSaga } from '../../../src/services/connection/connection-saga';

describe('ConnectionSaga (Timeout handling)', () => {
    const mockLogger = {
        debug: vi.fn(),
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
    };

    const mockTimeService = {
        get serverTime() {
            return 123456789;
        },
    };

    const mockCallService = {
        dial: vi.fn().mockResolvedValue(undefined),
        offer: vi.fn().mockResolvedValue(undefined),
        answer: vi.fn().mockResolvedValue(undefined),
        ice: vi.fn().mockResolvedValue(undefined),
        initialize: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };

    const mockSessionService = {
        signingPublicKeyBase64: 'mock-signing-public-key',
        signingPublicKeyBase64Safe: 'mock-signing-public-key-safe',
        signingKeyPair: {
            publicKey: new Uint8Array([1, 2, 3]),
            secretKey: new Uint8Array([4, 5, 6]),
        },
        initialize: vi.fn().mockResolvedValue(undefined),
    };

    const mockBase64 = {
        encode: vi.fn((data) => 'encoded-' + Buffer.from(data).toString('hex')),
        decode: vi.fn((str) => {
            if (str.startsWith('encoded-')) {
                return Buffer.from(str.substring(8), 'hex');
            }
            return new Uint8Array(Buffer.from(str, 'base64'));
        }),
    };

    const mockUtf8 = {
        encode: vi.fn((data) => Buffer.from(data).toString('utf-8')),
        decode: vi.fn((str) => new Uint8Array(Buffer.from(str, 'utf-8'))),
    };

    const mockCryptography = {
        generateEncryptionKeyPair: vi.fn(() => ({
            publicKey: new Uint8Array([1, 2, 3]),
            secretKey: new Uint8Array([4, 5, 6]),
        })),
        generateSharedSymmetricKey: vi.fn(() => new Uint8Array([7, 8, 9])),
        encrypt: vi.fn((data) => data),
        decrypt: vi.fn((data) => data),
        sign: vi.fn(() => new Uint8Array([10, 11, 12])),
        verifySignature: vi.fn(() => true),
        generateSigningKeyPair: vi.fn(() => ({
            publicKey: new Uint8Array([13, 14, 15]),
            secretKey: new Uint8Array([16, 17, 18]),
        })),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should handle timeout in awaitDial', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'outgoing';

        const mockDataChannel = {
            id: 'data-channel-id',
            label: 'mock-data-channel',
            readyState: 'connecting',
            onopen: vi.fn(),
            onmessage: vi.fn(),
            close: vi.fn(),
            send: vi.fn(),
        };

        const mockPeerConnection = {
            createDataChannel: vi.fn(() => mockDataChannel),
            createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' }),
            createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp' }),
            setLocalDescription: vi.fn().mockResolvedValue(undefined),
            setRemoteDescription: vi.fn().mockResolvedValue(undefined),
            close: vi.fn(),
            onicecandidate: null,
            ondatachannel: null,
        };

        const mockWebRTC = {
            PeerConnection: vi.fn(function () {
                return mockPeerConnection;
            }),
        };

        const saga = getConnectionSaga(
            publicKey,
            connectionType,
            mockLogger,
            mockTimeService,
            () => mockCallService,
            () => TEST_PRIME_SERVER_URL,
            mockSessionService,
            mockBase64,
            mockUtf8,
            mockCryptography,
            // @ts-ignore
            mockWebRTC,
            [],
            10,
        );

        const stateTransitions: ConnectionSagaState[] = [];
        saga.onStateChanged = (from, to) => {
            stateTransitions.push(to);
        };

        await saga.open(ConnectionSagaState.AwaitDial);

        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(stateTransitions).toContain(ConnectionSagaState.AwaitingDial);
        expect(stateTransitions).toContain(ConnectionSagaState.New);

        expect(saga.state).toBe(ConnectionSagaState.New);

        expect(mockLogger.debug).toHaveBeenCalledWith(
            expect.stringContaining('Awaiting for Dial in outgoing connection'),
        );

        saga.abort();
    });

    it('should handle timeout in awaitOffer', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'outgoing';

        const mockDataChannel = {
            id: 'data-channel-id',
            label: 'mock-data-channel',
            readyState: 'connecting',
            onopen: vi.fn(),
            onmessage: vi.fn(),
            close: vi.fn(),
            send: vi.fn(),
        };

        const mockPeerConnection = {
            createDataChannel: vi.fn(() => mockDataChannel),
            createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' }),
            createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp' }),
            setLocalDescription: vi.fn().mockResolvedValue(undefined),
            setRemoteDescription: vi.fn().mockResolvedValue(undefined),
            close: vi.fn(),
            onicecandidate: null,
            ondatachannel: null,
        };

        const mockWebRTC = {
            PeerConnection: vi.fn(function () {
                return mockPeerConnection;
            }),
        };

        const saga = getConnectionSaga(
            publicKey,
            connectionType,
            mockLogger,
            mockTimeService,
            () => mockCallService,
            () => TEST_PRIME_SERVER_URL,
            mockSessionService,
            mockBase64,
            mockUtf8,
            mockCryptography,
            // @ts-ignore
            mockWebRTC,
            [],
            10,
        );

        const stateTransitions: ConnectionSagaState[] = [];
        saga.onStateChanged = (from, to) => {
            stateTransitions.push(to);
        };

        await saga.open(ConnectionSagaState.AwaitOffer);

        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(stateTransitions).toContain(ConnectionSagaState.AwaitingOffer);
        expect(stateTransitions).toContain(ConnectionSagaState.New);

        expect(saga.state).toBe(ConnectionSagaState.New);

        expect(mockLogger.debug).toHaveBeenCalledWith(
            expect.stringContaining('Awaiting for Offer in outgoing connection'),
        );

        saga.abort();
    });

    it('should handle timeout in awaitAnswer', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'outgoing';

        const mockDataChannel = {
            id: 'data-channel-id',
            label: 'mock-data-channel',
            readyState: 'connecting',
            onopen: vi.fn(),
            onmessage: vi.fn(),
            close: vi.fn(),
            send: vi.fn(),
        };

        const mockPeerConnection = {
            createDataChannel: vi.fn(() => mockDataChannel),
            createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' }),
            createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp' }),
            setLocalDescription: vi.fn().mockResolvedValue(undefined),
            setRemoteDescription: vi.fn().mockResolvedValue(undefined),
            close: vi.fn(),
            onicecandidate: null,
            ondatachannel: null,
        };

        const mockWebRTC = {
            PeerConnection: vi.fn(function () {
                return mockPeerConnection;
            }),
        };

        const saga = getConnectionSaga(
            publicKey,
            connectionType,
            mockLogger,
            mockTimeService,
            () => mockCallService,
            () => TEST_PRIME_SERVER_URL,
            mockSessionService,
            mockBase64,
            mockUtf8,
            mockCryptography,
            // @ts-ignore
            mockWebRTC,
            [],
            10,
        );

        const stateTransitions: ConnectionSagaState[] = [];
        saga.onStateChanged = (from, to) => {
            stateTransitions.push(to);
        };

        saga.setEncryption('mock-encryption-public-key');

        await saga.open(ConnectionSagaState.AwaitAnswer);

        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(stateTransitions).toContain(ConnectionSagaState.AwaitingAnswer);
        expect(stateTransitions).toContain(ConnectionSagaState.New);

        expect(saga.state).toBe(ConnectionSagaState.New);

        expect(mockLogger.debug).toHaveBeenCalledWith(
            expect.stringContaining('Awaiting for Answer in outgoing connection'),
        );

        saga.abort();
    });

    it('should handle timeout in awaitConnection', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'outgoing';

        const mockDataChannel = {
            id: 'data-channel-id',
            label: 'mock-data-channel',
            readyState: 'connecting',
            onopen: vi.fn(),
            onmessage: vi.fn(),
            close: vi.fn(),
            send: vi.fn(),
        };

        const mockPeerConnection = {
            createDataChannel: vi.fn(() => mockDataChannel),
            createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' }),
            createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp' }),
            setLocalDescription: vi.fn().mockResolvedValue(undefined),
            setRemoteDescription: vi.fn().mockResolvedValue(undefined),
            close: vi.fn(),
            onicecandidate: null,
            ondatachannel: null,
        };

        const mockWebRTC = {
            PeerConnection: vi.fn(function () {
                return mockPeerConnection;
            }),
        };

        const saga = getConnectionSaga(
            publicKey,
            connectionType,
            mockLogger,
            mockTimeService,
            () => mockCallService,
            () => TEST_PRIME_SERVER_URL,
            mockSessionService,
            mockBase64,
            mockUtf8,
            mockCryptography,
            // @ts-ignore
            mockWebRTC,
            [],
            10,
        );

        const stateTransitions: ConnectionSagaState[] = [];
        saga.onStateChanged = (from, to) => {
            stateTransitions.push(to);
        };

        saga.setEncryption('mock-encryption-public-key');

        await saga.open(ConnectionSagaState.AwaitConnection);

        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(stateTransitions).toContain(ConnectionSagaState.AwaitingConnection);
        expect(stateTransitions).toContain(ConnectionSagaState.New);

        expect(saga.state).toBe(ConnectionSagaState.New);

        expect(mockLogger.debug).toHaveBeenCalledWith(
            expect.stringContaining('Awaiting for Connection in outgoing connection'),
        );

        saga.abort();
    });
});
