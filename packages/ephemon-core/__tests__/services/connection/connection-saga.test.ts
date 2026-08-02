import {
    createMockBase64,
    createMockCallService,
    createMockCryptography,
    createMockDataChannel,
    createMockLogger,
    createMockPeerConnection,
    createMockSessionService,
    createMockTimeService,
    createMockUtf8,
    TEST_PRIME_SERVER_URL,
} from '../../../__mocks__/test-utils';
import {
    ConnectionSaga,
    ConnectionSagaState,
    ConnectionSagaType,
    getConnectionSaga,
} from '../../../src/services/connection/connection-saga';

describe('ConnectionSaga', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let mockTimeService: ReturnType<typeof createMockTimeService>;
    let mockCallService: ReturnType<typeof createMockCallService>;
    let mockSessionService: ReturnType<typeof createMockSessionService>;
    let mockBase64: ReturnType<typeof createMockBase64>;
    let mockUtf8: ReturnType<typeof createMockUtf8>;
    let mockCryptography: ReturnType<typeof createMockCryptography>;
    let mockWebRTC: { PeerConnection: any };
    let mockDataChannel: any;

    beforeEach(() => {
        mockLogger = createMockLogger();
        mockTimeService = createMockTimeService();
        mockCallService = createMockCallService();
        mockSessionService = createMockSessionService();
        mockBase64 = createMockBase64();
        mockUtf8 = createMockUtf8();
        mockCryptography = createMockCryptography();
        mockDataChannel = createMockDataChannel();
        mockWebRTC = {
            PeerConnection: vi.fn(function () {
                return createMockPeerConnection({}, mockDataChannel);
            }),
        };
        vi.clearAllMocks();
    });

    it('should initialize and send offer for outgoing connection, verifying encryption and state transitions', async () => {
        const publicKey = 'mock-offer-public-key';
        const connectionType = 'outgoing' as ConnectionSagaType;
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
            1000,
        );
        saga.setEncryption('mock-encryption-public-key');
        const stateTransitions: ConnectionSagaState[] = [];
        saga.onStateChanged = (from, to) => {
            stateTransitions.push(to);
        };
        const sagaPromise = saga.open(ConnectionSagaState.SendOffer);
        await sagaPromise;
        expect(mockCallService.offer).toHaveBeenCalledWith(
            mockSessionService.signingPublicKeyBase64,
            publicKey,
            expect.any(String),
            expect.any(Uint8Array),
        );
        expect(mockCryptography.encrypt).toHaveBeenCalled();
        expect(stateTransitions).toContain(ConnectionSagaState.SendingOffer);
        expect(stateTransitions).toContain(ConnectionSagaState.OfferSent);
    }, 10000);

    it('should expose correct public API and initial state for a new incoming saga', async () => {
        const publicKey = 'mock-accessor-public-key';
        const connectionType = 'incoming' as ConnectionSagaType;
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
            {},
        );
        expect(saga.publicKey).toBe(publicKey);
        expect(saga.type).toBe(connectionType);
        expect(saga.state).toBe(ConnectionSagaState.New);
        expect(saga.transport).toBeUndefined();
        expect(typeof saga.abort).toBe('function');
        expect(typeof saga.continue).toBe('function');
    });

    it('should transition through AwaitDial, DialAccepted, and SendOffer states for outgoing connection', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'outgoing';
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
        saga.setEncryption('mock-encryption-public-key');
        const stateTransitions: ConnectionSagaState[] = [];
        saga.onStateChanged = (from, to) => {
            stateTransitions.push(to);
        };
        const openPromise = saga.open(ConnectionSagaState.AwaitDial);
        saga.continue();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(stateTransitions).toContain(ConnectionSagaState.AwaitingDial);
        expect(stateTransitions).toContain(ConnectionSagaState.DialAccepted);
        expect(stateTransitions).toContain(ConnectionSagaState.SendOffer);
        expect(mockCallService.dial).toHaveBeenCalledTimes(0);
        saga.abort();
    });

    it('should transition through AwaitAnswer, AnswerReceived, and AwaitConnection states for outgoing connection', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'outgoing';
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
        saga.setEncryption('mock-encryption-public-key');
        const stateTransitions: ConnectionSagaState[] = [];
        saga.onStateChanged = (from, to) => {
            stateTransitions.push(to);
        };
        const openPromise = saga.open(ConnectionSagaState.AwaitAnswer);
        saga.continue();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(stateTransitions).toContain(ConnectionSagaState.AwaitingAnswer);
        expect(stateTransitions).toContain(ConnectionSagaState.AnswerReceived);
        expect(stateTransitions).toContain(ConnectionSagaState.AwaitConnection);
        expect(mockCallService.answer).toHaveBeenCalledTimes(0);
        saga.abort();
    });
});
