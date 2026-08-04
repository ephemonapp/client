import {
    createMockBase64,
    createMockCallService,
    createMockCallServiceFactory,
    createMockCryptography,
    createMockLogger,
    createMockSessionService,
    createMockTimeService,
    createMockUtf8,
    TEST_PRIME_SERVER_URL,
} from '../../../__mocks__/test-utils';
import { CallService } from '../../../src/services/call-service';
import { ConnectionState, getConnection, translateConnection } from '../../../src/services/connection/connection';
import { ConnectionSagaState, getConnectionSaga } from '../../../src/services/connection/connection-saga';
import { IceServer } from '../../../src/services/connection/ice-server';
import { WebRTC } from '../../../src/services/connection/web-rtc';
import { SessionService } from '../../../src/services/session-service';
import { TimeService } from '../../../src/services/time-service';
import { Base64 } from '../../../src/utils/base64';
import { Cryptography } from '../../../src/utils/cryptography';
import { Logger } from '../../../src/utils/logger';
import { Utf8 } from '../../../src/utils/utf8';

const mockSagaOpen = vi.fn().mockImplementation(async (state) => {
    return {
        type: 'mock',
        state,
    };
});

const mockSagaClose = vi.fn();
const mockSagaContinue = vi.fn();
const mockSagaAbort = vi.fn();
const mockSagaSend = vi.fn();
const mockSagaSetEncryption = vi.fn();
const mockSagaSetDescription = vi.fn().mockResolvedValue(undefined);
const mockSagaAddIceCandidate = vi.fn().mockResolvedValue(undefined);
const binaryMessage = new Uint8Array([0, 1, 255]);

vi.mock('../../../src/services/connection/connection-saga', async (importOriginal) => {
    const originalModule = await importOriginal<typeof import('../../../src/services/connection/connection-saga')>();

    return {
        ...originalModule,
        getConnectionSaga: vi.fn().mockImplementation((publicKey, type) => ({
            publicKey,
            type,
            state: originalModule.ConnectionSagaState.New,
            open: mockSagaOpen,
            close: mockSagaClose,
            continue: mockSagaContinue,
            abort: mockSagaAbort,
            send: mockSagaSend,
            setEncryption: mockSagaSetEncryption,
            setDescription: mockSagaSetDescription,
            addIceCandidate: mockSagaAddIceCandidate,
            onMessage: null,
            onStateChanged: null,
        })),
    };
});

const mockGetConnectionSaga = getConnectionSaga as unknown as Mock;

describe('Connection Tests', () => {
    let mockLogger: Logger;
    let mockCallService: CallService;
    let mockCallServiceFactory: ReturnType<typeof createMockCallServiceFactory>;
    let mockCryptography: Cryptography;
    let mockTimeService: TimeService;
    let mockSessionService: SessionService;
    let mockPublicKey: string;
    let mockBase64: Base64;
    let mockUtf8: Utf8;
    let mockWebRTC: WebRTC;
    let mockIceServers: IceServer[];

    beforeEach(() => {
        vi.clearAllMocks();

        mockLogger = createMockLogger();
        mockPublicKey = 'test-public-key';
        mockCallService = createMockCallService() as unknown as CallService;
        mockCallServiceFactory = createMockCallServiceFactory(mockCallService);
        mockTimeService = createMockTimeService() as unknown as TimeService;
        mockSessionService = createMockSessionService() as unknown as SessionService;
        mockBase64 = createMockBase64() as unknown as Base64;
        mockUtf8 = createMockUtf8() as unknown as Utf8;
        mockCryptography = createMockCryptography() as unknown as Cryptography;
        mockWebRTC = {
            PeerConnection: vi.fn(),
            DataChannel: vi.fn(),
        } as unknown as WebRTC;
        mockIceServers = [{ urls: 'stun:stun.example.com' }];
    });

    describe('Connection Creation', () => {
        it('should create a connection', () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            expect(connection).toBeDefined();
            expect(connection.publicKey).toBe(mockPublicKey);
            expect(connection.state).toBe(ConnectionState.New);
        });

        it('should translate internal connection to external connection', () => {
            const internalConnection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            const externalConnection = translateConnection(internalConnection);

            expect(externalConnection).toBeDefined();
            expect(externalConnection.publicKey).toBe(mockPublicKey);
            expect(externalConnection.state).toBe(ConnectionState.New);
        });
    });

    describe('Connection Transport', () => {
        const mockDefaultSaga = () => {
            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: ConnectionSagaState.New,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));
        };

        afterEach(mockDefaultSaga);

        const mockConnectedSaga = (getTransport: () => string | undefined) => {
            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: ConnectionSagaState.Connected,
                get transport() {
                    return getTransport();
                },
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
                onTransportChanged: null,
            }));
        };

        const build = () =>
            getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

        it('should expose the transport of the connected saga', () => {
            mockConnectedSaga(() => 'relay');

            const connection = build();

            expect(connection.transport).toBe('relay');
        });

        it('should be undefined when no saga is connected', () => {
            mockDefaultSaga();

            const connection = build();

            expect(connection.transport).toBeUndefined();
        });

        it('should forward saga transport changes to onTransportChanged', () => {
            mockConnectedSaga(() => 'relay');

            const connection = build();
            const onTransportChangedMock = vi.fn();
            connection.onTransportChanged = onTransportChangedMock;
            expect(connection.onTransportChanged).toBe(onTransportChangedMock);

            const mockSaga = mockGetConnectionSaga.mock.results[0].value;
            mockSaga.onTransportChanged('relay');

            expect(onTransportChangedMock).toHaveBeenCalledWith('relay');
        });

        it('should not throw when a saga transport change arrives without a listener', () => {
            mockConnectedSaga(() => 'direct');

            build();

            const mockSaga = mockGetConnectionSaga.mock.results[0].value;
            expect(() => mockSaga.onTransportChanged('direct')).not.toThrow();
        });

        it('should not notify when the current transport is undefined', () => {
            mockConnectedSaga(() => undefined);

            const connection = build();
            const onTransportChangedMock = vi.fn();
            connection.onTransportChanged = onTransportChangedMock;

            const mockSaga = mockGetConnectionSaga.mock.results[0].value;
            mockSaga.onTransportChanged(undefined);

            expect(onTransportChangedMock).not.toHaveBeenCalled();
        });

        it('should proxy transport and onTransportChanged through translateConnection', () => {
            mockConnectedSaga(() => 'relay');

            const external = translateConnection(build());
            expect(external.transport).toBe('relay');

            const onTransportChangedMock = vi.fn();
            external.onTransportChanged = onTransportChangedMock;
            expect(external.onTransportChanged).toBe(onTransportChangedMock);
        });
    });

    describe('Connection State Management', () => {
        it('should have the correct initial state', () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            expect(connection.state).toBe(ConnectionState.New);
        });

        it('should handle onProgress callback', () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            const onProgressMock = vi.fn();
            connection.onProgress = onProgressMock;

            expect(connection.onProgress).toBe(onProgressMock);
        });

        it('should handle onStateChanged callback', () => {
            const onStateChangedMock = vi.fn();

            let sagaState = ConnectionSagaState.New;
            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => {
                return {
                    publicKey,
                    type,
                    get state() {
                        return sagaState;
                    },
                    open: mockSagaOpen,
                    close: mockSagaClose,
                    continue: mockSagaContinue,
                    abort: mockSagaAbort,
                    send: mockSagaSend,
                    setEncryption: mockSagaSetEncryption,
                    setDescription: mockSagaSetDescription,
                    addIceCandidate: mockSagaAddIceCandidate,
                    onMessage: null,
                    onStateChanged: null,
                };
            });

            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            connection.onStateChanged = onStateChangedMock;

            const mockSaga = mockGetConnectionSaga.mock.results[0].value;

            expect(connection.state).toBe(ConnectionState.New);

            sagaState = ConnectionSagaState.Connected;
            mockSaga.onStateChanged(ConnectionSagaState.New, ConnectionSagaState.Connected);

            expect(onStateChangedMock).toHaveBeenCalledWith(ConnectionState.New, ConnectionState.Open);
        });

        it('should handle onMessage callback', () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            const onMessageMock = vi.fn();
            connection.onMessage = onMessageMock;

            expect(connection.onMessage).toBe(onMessageMock);
        });

        it('should debug log saga state changes when from !== to', () => {
            getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );
            const sagaResults = mockGetConnectionSaga.mock.results;
            const mockSaga = sagaResults[sagaResults.length - 1].value;
            mockSaga.onStateChanged(ConnectionSagaState.New, ConnectionSagaState.AwaitOffer);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `[connection-saga] State changed in ${mockSaga.type} connection saga with ${mockPublicKey} from ${ConnectionSagaState[ConnectionSagaState.New]} to ${ConnectionSagaState[ConnectionSagaState.AwaitOffer]}.`,
            );
        });

        it('should not debug log saga state changes when from === to', () => {
            getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );
            const sagaResults = mockGetConnectionSaga.mock.results;
            const mockSaga = sagaResults[sagaResults.length - 1].value;
            mockSaga.onStateChanged(ConnectionSagaState.New, ConnectionSagaState.New);
            expect(mockLogger.debug).not.toHaveBeenCalledWith(
                expect.stringContaining('[connection-saga] State changed'),
            );
        });
    });

    describe('Connection Operations', () => {
        it('should open incoming connection', async () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            await connection.openIncoming();
            expect(mockSagaOpen).toHaveBeenCalledTimes(2);
        });

        it('should open outgoing connection', async () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            await connection.openOutgoing();
            expect(mockSagaOpen).toHaveBeenCalledTimes(2);
        });

        it('should open regular connection via external interface', async () => {
            const internalConnection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            const externalConnection = translateConnection(internalConnection);
            await externalConnection.open();

            expect(mockSagaOpen).toHaveBeenCalledTimes(2);
        });

        it('should close the connection', () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            connection.close();
            expect(mockSagaAbort).toHaveBeenCalledTimes(2);
        });

        it('should send messages when connection is ready', async () => {
            const mockSagaWithConnectedState = {
                publicKey: mockPublicKey,
                type: 'incoming',
                state: ConnectionSagaState.Connected,
                send: mockSagaSend,
                abort: mockSagaAbort,
                continue: mockSagaContinue,
                open: mockSagaOpen,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            };

            mockGetConnectionSaga.mockImplementation(() => mockSagaWithConnectedState);

            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            connection.send(binaryMessage);
            expect(mockSagaSend).toHaveBeenCalledWith(binaryMessage);
        });

        it('should correctly handle incomingState and outgoingState', () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            expect(connection.incomingState).toBe(ConnectionSagaState.Connected);
            expect(connection.outgoingState).toBe(ConnectionSagaState.Connected);
        });

        it('should throw an error when sending message but connection is not ready', async () => {
            vi.clearAllMocks();
            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: ConnectionSagaState.New,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));

            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            expect(() => {
                connection.send(binaryMessage);
            }).toThrow('[connection] Connection is not ready yet.');

            expect(mockSagaSend).not.toHaveBeenCalled();
        });

        it('should send message through outgoing saga when it is connected', async () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            const sagas = mockGetConnectionSaga.mock.results;

            sagas[0].value.state = ConnectionSagaState.AwaitConnection;

            sagas[1].value.state = ConnectionSagaState.Connected;

            connection.send(binaryMessage);

            expect(mockSagaSend).toHaveBeenCalledWith(binaryMessage);
        });
    });

    describe('Connection Handling', () => {
        it('should continue incoming saga', () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            connection.continueIncoming();
            expect(mockSagaContinue).toHaveBeenCalledTimes(1);
        });

        it('should continue outgoing saga', () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            connection.continueOutgoing();
            expect(mockSagaContinue).toHaveBeenCalledTimes(1);
        });

        it('should set incoming encryption', () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            connection.setIncomingEncryption('test-key');
            expect(mockSagaSetEncryption).toHaveBeenCalledWith('test-key');
        });

        it('should set outgoing encryption', () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            connection.setOutgoingEncryption('test-key');
            expect(mockSagaSetEncryption).toHaveBeenCalledWith('test-key');
        });

        it('should set incoming description', async () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            await connection.setIncomingDescription('test-description');
            expect(mockSagaSetDescription).toHaveBeenCalledWith('test-description');
        });

        it('should set outgoing description', async () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            await connection.setOutgoingDescription('test-description');
            expect(mockSagaSetDescription).toHaveBeenCalledWith('test-description');
        });

        it('should add incoming ICE candidate', async () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            await connection.addIncomingIce('test-candidate');
            expect(mockSagaAddIceCandidate).toHaveBeenCalledWith('test-candidate');
        });

        it('should add outgoing ICE candidate', async () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            await connection.addOutgoingIce('test-candidate');
            expect(mockSagaAddIceCandidate).toHaveBeenCalledWith('test-candidate');
        });
    });

    describe('Connection Callbacks', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('should handle onProgress callback', () => {
            const onProgressMock = vi.fn();

            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: ConnectionSagaState.New,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));

            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            connection.onProgress = onProgressMock;

            const mockSaga = mockGetConnectionSaga.mock.results[0].value;

            mockSaga.onStateChanged(ConnectionSagaState.New, ConnectionSagaState.AwaitOffer);

            expect(onProgressMock).toHaveBeenCalled();
            expect(onProgressMock).toHaveBeenCalledWith(expect.any(Number));
        });

        it('should handle onMessage callback', () => {
            const onMessageMock = vi.fn();

            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: ConnectionSagaState.Connected,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));

            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            connection.onMessage = onMessageMock;

            const incomingSaga = mockGetConnectionSaga.mock.results[0].value;
            const outgoingSaga = mockGetConnectionSaga.mock.results[1].value;

            const incomingMessage = new Uint8Array([1]);
            incomingSaga.onMessage(incomingMessage);

            const outgoingMessage = new Uint8Array([2]);
            outgoingSaga.onMessage(outgoingMessage);

            expect(onMessageMock).toHaveBeenCalledTimes(2);
            expect(onMessageMock).toHaveBeenCalledWith(incomingMessage);
            expect(onMessageMock).toHaveBeenCalledWith(outgoingMessage);
        });

        it('should handle errors in callbacks gracefully', () => {
            const errorCallback = vi.fn().mockImplementation(() => {
                throw new Error('Test error');
            });

            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: ConnectionSagaState.Connected,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));

            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            connection.onProgress = errorCallback;
            connection.onStateChanged = errorCallback;
            connection.onMessage = errorCallback;

            const mockSaga = mockGetConnectionSaga.mock.results[0].value;

            let errorThrown = false;
            try {
                mockSaga.onStateChanged(ConnectionSagaState.New, ConnectionSagaState.Connected);
            } catch (e) {
                errorThrown = true;
            }
            expect(errorThrown).toBe(false);
            expect(errorCallback).toHaveBeenCalled();

            errorCallback.mockClear();

            errorThrown = false;
            try {
                mockSaga.onMessage(binaryMessage);
            } catch (e) {
                errorThrown = true;
            }
            expect(errorThrown).toBe(false);
            expect(errorCallback).toHaveBeenCalled();
        });
    });

    describe('Connection Extended Operations', () => {
        it('should initialize with correct default values', () => {
            vi.clearAllMocks();
            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: ConnectionSagaState.New,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));

            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            expect(connection.publicKey).toBe(mockPublicKey);
            expect(connection.state).toBe(ConnectionState.New);
            expect(connection.openedAt).toBeUndefined();
            expect(connection.incomingState).toBe(ConnectionSagaState.New);
            expect(connection.outgoingState).toBe(ConnectionSagaState.New);
        });

        it('should correctly translate an internal connection to external interface', () => {
            vi.clearAllMocks();
            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: ConnectionSagaState.New,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));

            const internalConnection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            const externalConnection = translateConnection(internalConnection);

            expect(externalConnection.publicKey).toBe(mockPublicKey);
            expect(externalConnection.state).toBe(ConnectionState.New);

            expect((externalConnection as any).incomingState).toBeUndefined();
            expect((externalConnection as any).outgoingState).toBeUndefined();
            expect((externalConnection as any).openIncoming).toBeUndefined();
            expect((externalConnection as any).openOutgoing).toBeUndefined();
            expect((externalConnection as any).continueIncoming).toBeUndefined();
            expect((externalConnection as any).continueOutgoing).toBeUndefined();
            expect((externalConnection as any).setIncomingEncryption).toBeUndefined();
            expect((externalConnection as any).setOutgoingEncryption).toBeUndefined();
        });

        it('should set openedAt timestamp when opening a connection', async () => {
            vi.clearAllMocks();
            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: ConnectionSagaState.New,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));

            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            const incomingResult = await connection.openIncoming();
            expect(incomingResult).toBe(connection);
            expect(connection.openedAt).toBe(mockTimeService.serverTime);

            const connection2 = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            const outgoingResult = await connection2.openOutgoing();
            expect(outgoingResult).toBe(connection2);
            expect(connection2.openedAt).toBe(mockTimeService.serverTime);
        });

        it('should call CallService.close when closing the connection', () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            connection.close();

            expect(mockCallService.close).toHaveBeenCalledWith(
                mockSessionService.signingPublicKeyBase64,
                mockPublicKey,
            );
        });

        it('should tear down without telling the peer when the peer closed the conversation', async () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );
            const onClosedByPeer = vi.fn();
            connection.onClosedByPeer = onClosedByPeer;

            connection.closeByPeer();
            await Promise.resolve();

            expect(mockSagaAbort).toHaveBeenCalledTimes(2);
            expect(mockCallService.close).not.toHaveBeenCalled();
            expect(onClosedByPeer).toHaveBeenCalled();
        });

        it('should survive a missing closed by peer listener', () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            expect(() => connection.closeByPeer()).not.toThrow();
            expect(mockSagaAbort).toHaveBeenCalledTimes(2);
        });

        it('should log a closed by peer listener that throws', async () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );
            connection.onClosedByPeer = () => {
                throw new Error('boom');
            };

            connection.closeByPeer();
            await Promise.resolve();

            expect(mockLogger.error).toHaveBeenCalledWith(
                `[connection] Closed by peer callback error in connection with ${mockPublicKey}.`,
                expect.any(Error),
            );
        });

        it('should abandon an open attempt that the peer closed mid-flight', async () => {
            let releaseServer: (value: CallService) => void = () => {};
            mockCallServiceFactory.getForServerUrl.mockImplementationOnce(
                () => new Promise<CallService>((resolve) => (releaseServer = resolve)),
            );
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            const attempt = connection.openOutgoing();
            connection.closeByPeer();
            releaseServer(mockCallService);
            await attempt;

            expect(mockSagaOpen).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('abandoned'));
        });
    });

    describe('Connection State Determination', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        const stateOf = (incoming: ConnectionSagaState, outgoing: ConnectionSagaState) => {
            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: type === 'incoming' ? incoming : outgoing,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));

            return getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
            ).state;
        };

        it('should return Closed state when both sagas are Closed', () => {
            expect(stateOf(ConnectionSagaState.Closed, ConnectionSagaState.Closed)).toBe(ConnectionState.Closed);
        });

        it('should return Degraded state when one saga is Closed and the other is Connected', () => {
            expect(stateOf(ConnectionSagaState.Closed, ConnectionSagaState.Connected)).toBe(ConnectionState.Degraded);
            expect(stateOf(ConnectionSagaState.Connected, ConnectionSagaState.Closed)).toBe(ConnectionState.Degraded);
        });

        it('should return Closed state when one saga is Closed and the other is idle', () => {
            expect(stateOf(ConnectionSagaState.Closed, ConnectionSagaState.New)).toBe(ConnectionState.Closed);
            expect(stateOf(ConnectionSagaState.New, ConnectionSagaState.Closed)).toBe(ConnectionState.Closed);
        });

        it('should return Connecting state when one saga is Closed and the other is negotiating', () => {
            expect(stateOf(ConnectionSagaState.Closed, ConnectionSagaState.AwaitingOffer)).toBe(
                ConnectionState.Connecting,
            );
            expect(stateOf(ConnectionSagaState.SendingAnswer, ConnectionSagaState.Closed)).toBe(
                ConnectionState.Connecting,
            );
        });

        it('should return Open state when either saga is Connected', () => {
            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: type === 'incoming' ? ConnectionSagaState.Connected : ConnectionSagaState.AwaitingOffer,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));

            const connection1 = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );
            expect(connection1.state).toBe(ConnectionState.Open);

            vi.clearAllMocks();
            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: type === 'incoming' ? ConnectionSagaState.AwaitingOffer : ConnectionSagaState.Connected,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));

            const connection2 = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );
            expect(connection2.state).toBe(ConnectionState.Open);
        });

        it('should return New state when both sagas are New', () => {
            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: ConnectionSagaState.New,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));

            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );
            expect(connection.state).toBe(ConnectionState.New);
        });

        it('should return Connecting state when in intermediate states', () => {
            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: type === 'incoming' ? ConnectionSagaState.AwaitingOffer : ConnectionSagaState.New,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));

            const connection1 = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );
            expect(connection1.state).toBe(ConnectionState.Connecting);

            vi.clearAllMocks();
            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: type === 'incoming' ? ConnectionSagaState.New : ConnectionSagaState.AwaitingAnswer,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));

            const connection2 = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );
            expect(connection2.state).toBe(ConnectionState.Connecting);

            vi.clearAllMocks();
            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: type === 'incoming' ? ConnectionSagaState.SendingAnswer : ConnectionSagaState.AwaitingConnection,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));

            const connection3 = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );
            expect(connection3.state).toBe(ConnectionState.Connecting);
        });
    });

    describe('Connected Saga Ordering', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        const controllableSagas = () => {
            const sagas: Record<string, any> = {};
            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => {
                const saga = {
                    publicKey,
                    type,
                    state: ConnectionSagaState.New,
                    get transport() {
                        return type;
                    },
                    open: mockSagaOpen,
                    close: mockSagaClose,
                    continue: mockSagaContinue,
                    abort: mockSagaAbort,
                    send: vi.fn(),
                    setEncryption: mockSagaSetEncryption,
                    setDescription: mockSagaSetDescription,
                    addIceCandidate: mockSagaAddIceCandidate,
                    onMessage: null,
                    onStateChanged: null,
                    onTransportChanged: null,
                };
                sagas[type] = saga;
                return saga;
            });
            return sagas;
        };

        const build = () =>
            getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

        const connect = (saga: any) => {
            saga.state = ConnectionSagaState.Connected;
            saga.onStateChanged(ConnectionSagaState.AwaitingConnection, ConnectionSagaState.Connected);
        };

        it('should select the incoming saga when it connects first', () => {
            const sagas = controllableSagas();
            const connection = build();

            connect(sagas.incoming);
            connect(sagas.outgoing);

            connection.send(binaryMessage);
            expect(sagas.incoming.send).toHaveBeenCalledWith(binaryMessage);
            expect(sagas.outgoing.send).not.toHaveBeenCalled();
            expect(connection.transport).toBe('incoming');
        });

        it('should select the outgoing saga when it connects first', () => {
            const sagas = controllableSagas();
            const connection = build();

            connect(sagas.outgoing);
            connect(sagas.incoming);

            connection.send(binaryMessage);
            expect(sagas.outgoing.send).toHaveBeenCalledWith(binaryMessage);
            expect(sagas.incoming.send).not.toHaveBeenCalled();
            expect(connection.transport).toBe('outgoing');
        });

        it('should not reorder when the same saga reports Connected more than once', () => {
            const sagas = controllableSagas();
            const connection = build();

            connect(sagas.incoming);
            connect(sagas.incoming);
            connect(sagas.outgoing);

            connection.send(binaryMessage);
            expect(sagas.incoming.send).toHaveBeenCalledWith(binaryMessage);
            expect(sagas.outgoing.send).not.toHaveBeenCalled();
        });

        it('should skip a first-connected saga that is no longer Connected', () => {
            const sagas = controllableSagas();
            const connection = build();

            connect(sagas.incoming);
            connect(sagas.outgoing);

            sagas.incoming.state = ConnectionSagaState.New;

            connection.send(binaryMessage);
            expect(sagas.outgoing.send).toHaveBeenCalledWith(binaryMessage);
            expect(sagas.incoming.send).not.toHaveBeenCalled();
            expect(connection.transport).toBe('outgoing');
        });

        it('should fall back to the fixed order when no connected transition was observed', () => {
            const sagas = controllableSagas();
            const connection = build();

            sagas.incoming.state = ConnectionSagaState.Connected;
            sagas.outgoing.state = ConnectionSagaState.Connected;

            connection.send(binaryMessage);
            expect(sagas.incoming.send).toHaveBeenCalledWith(binaryMessage);
            expect(sagas.outgoing.send).not.toHaveBeenCalled();
        });
    });

    describe('Connection Translation', () => {
        it('should correctly access and set callbacks through translated interface', () => {
            const connection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            const externalConnection = translateConnection(connection);

            const onProgressMock = vi.fn();
            expect(externalConnection.onProgress).toBeUndefined();
            externalConnection.onProgress = onProgressMock;
            expect(connection.onProgress).toBe(onProgressMock);
            expect(externalConnection.onProgress).toBe(onProgressMock);

            const onStateChangedMock = vi.fn();
            expect(externalConnection.onStateChanged).toBeUndefined();
            externalConnection.onStateChanged = onStateChangedMock;
            expect(connection.onStateChanged).toBe(onStateChangedMock);
            expect(externalConnection.onStateChanged).toBe(onStateChangedMock);

            const onMessageMock = vi.fn();
            expect(externalConnection.onMessage).toBeUndefined();
            externalConnection.onMessage = onMessageMock;
            expect(connection.onMessage).toBe(onMessageMock);
            expect(externalConnection.onMessage).toBe(onMessageMock);

            const onClosedByPeerMock = vi.fn();
            expect(externalConnection.onClosedByPeer).toBeUndefined();
            externalConnection.onClosedByPeer = onClosedByPeerMock;
            expect(connection.onClosedByPeer).toBe(onClosedByPeerMock);
            expect(externalConnection.onClosedByPeer).toBe(onClosedByPeerMock);

            mockGetConnectionSaga.mockImplementation((publicKey: string, type: string) => ({
                publicKey,
                type,
                state: ConnectionSagaState.Connected,
                open: mockSagaOpen,
                close: mockSagaClose,
                continue: mockSagaContinue,
                abort: mockSagaAbort,
                send: mockSagaSend,
                setEncryption: mockSagaSetEncryption,
                setDescription: mockSagaSetDescription,
                addIceCandidate: mockSagaAddIceCandidate,
                onMessage: null,
                onStateChanged: null,
            }));

            const connectedConnection = getConnection(
                mockPublicKey,
                mockLogger,
                mockTimeService,
                mockCallServiceFactory,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockWebRTC,
                mockIceServers,
                TEST_PRIME_SERVER_URL,
            );

            const translatedConnected = translateConnection(connectedConnection);

            translatedConnected.send(binaryMessage);
            expect(mockSagaSend).toHaveBeenCalledWith(binaryMessage);

            translatedConnected.close();
            expect(mockCallService.close).toHaveBeenCalledWith(
                mockSessionService.signingPublicKeyBase64,
                mockPublicKey,
            );
            expect(mockSagaAbort).toHaveBeenCalled();
        });
    });
});
