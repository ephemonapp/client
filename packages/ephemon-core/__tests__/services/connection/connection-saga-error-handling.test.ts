import { createMockDataChannel, createMockPeerConnection } from '../../../__mocks__/test-utils';
import {
    ConnectionSaga,
    ConnectionSagaState,
    ConnectionSagaType,
    getConnectionSaga,
} from '../../../src/services/connection/connection-saga';
import { newError } from '../../../src/utils/new-error';

describe('ConnectionSaga (Error Handling and Cleanup)', () => {
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
        mockLogger.debug = vi.fn();
        mockLogger.log = vi.fn();
        mockLogger.warn = vi.fn();
        mockLogger.error = vi.fn();
        mockLogger.trace = vi.fn();
        vi.clearAllMocks();
    });

    it('should handle errors when closing peer connection during abort', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'incoming';

        const mockPeerConnection = createMockPeerConnection({
            close: vi.fn().mockImplementation(() => {
                throw new Error('Error closing peer connection');
            }),
            remoteDescription: { type: 'offer', sdp: 'mock-sdp' },
        });

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
        );

        const errorSpy = vi.spyOn(mockLogger, 'error');

        await saga.open(ConnectionSagaState.New);

        saga.abort();

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('Error closing RTC peer connection'),
            expect.any(Error),
        );

        errorSpy.mockRestore();
    });

    it('should try to decode invalid SDP in setDescription and throw', async () => {
        const errorSpy = vi.spyOn(mockLogger, 'error');

        const mockSymmetricKey = new Uint8Array([1, 2, 3]);
        const mockDecrypt = vi.fn().mockReturnValue(
            mockUtf8.decode(
                JSON.stringify({
                    not_a_valid_description: true,
                }),
            ),
        );

        const mockPeerConnection = createMockPeerConnection();

        const testSetDescription = async () => {
            try {
                if (mockPeerConnection.remoteDescription) {
                    return;
                }

                const encryptedDataBytes = new Uint8Array([4, 5, 6]);

                const remoteDataBytes = mockDecrypt(encryptedDataBytes, mockSymmetricKey);

                const remoteDataString = mockUtf8.encode(remoteDataBytes);
                const remoteData = JSON.parse(remoteDataString);

                const remoteDescription = remoteData as any;
                if (!remoteDescription || remoteDescription.type === undefined) {
                    throw newError(
                        mockLogger,
                        `Wrong remote WebRTC description format in incoming connection with mock-key.`,
                    );
                }

                await mockPeerConnection.setRemoteDescription(remoteDescription);
            } catch (error) {
                throw error;
            }
        };

        await expect(testSetDescription()).rejects.toThrow('Wrong remote WebRTC description format');

        errorSpy.mockRestore();
    });

    it('should throw and log error for invalid ICE candidate in addIceCandidate', async () => {
        const publicKey = 'mock-key';
        const connectionType = 'incoming';
        const errorSpy = vi.spyOn(mockLogger, 'error');

        const mockPeerConnection = createMockPeerConnection({
            remoteDescription: { type: 'offer', sdp: 'mock-sdp' },
        });
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
        );
        saga.setEncryption('mock-encryption-key');

        await saga.open(ConnectionSagaState.New);

        const invalidIceObj = null;
        const invalidIceJson = JSON.stringify(invalidIceObj);
        const invalidIceBytes = new Uint8Array(Buffer.from(invalidIceJson, 'utf-8'));
        mockCryptography.decrypt.mockReturnValueOnce(invalidIceBytes);
        mockBase64.decode.mockReturnValueOnce(invalidIceBytes);
        mockUtf8.encode.mockReturnValueOnce(invalidIceJson);
        const fakeBase64 = 'invalid-ice-base64';

        await expect(saga.addIceCandidate(fakeBase64)).rejects.toThrow('Wrong remote WebRTC ice candidate format');
        expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
        expect(errorSpy.mock.calls[0][0].message).toContain('Wrong remote WebRTC ice candidate format');
        errorSpy.mockRestore();
    });

    it('should handle dataChannel.onopen event when state is Closed', async () => {
        const mockDataChannel = createMockDataChannel();

        const mockPeerConnection = createMockPeerConnection({}, mockDataChannel);

        const mockWebRTC = {
            PeerConnection: vi.fn(function () {
                return mockPeerConnection;
            }),
        };

        const publicKey = 'mock-remote-public-key';
        const connectionType = 'incoming';

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
        );

        saga.setEncryption('mock-encryption-public-key');

        await saga.open(ConnectionSagaState.New);
        saga.abort();

        expect(saga.state).toBe(ConnectionSagaState.Closed);

        if (mockDataChannel.onopen) {
            // @ts-ignore
            mockDataChannel.onopen();
        }

        expect(mockDataChannel.close).toHaveBeenCalled();
    });

    it('should handle error cases and edge conditions', async () => {
        const mockDataChannel = createMockDataChannel({
            send: vi.fn(() => {
                throw new Error('Send error');
            }),
        });

        const mockPeerConnection = createMockPeerConnection({}, mockDataChannel);

        const mockWebRTC = {
            PeerConnection: vi.fn(function () {
                return mockPeerConnection;
            }),
        };

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

        const openPromise = saga.open(ConnectionSagaState.SendOffer);

        await new Promise((resolve) => setTimeout(resolve, 10));

        mockPeerConnection.remoteDescription = {
            type: 'offer',
            sdp: 'mock-sdp',
            toJSON: () => ({ type: 'offer', sdp: 'mock-sdp' }),
        };

        const encryptedOfferDataBase64 = mockBase64.encode(
            mockUtf8.decode(JSON.stringify({ description: { type: 'offer', sdp: 'mock-sdp-offer' } })),
        );
        await saga.setDescription(encryptedOfferDataBase64);

        mockDataChannel.readyState = 'closed';

        setState(ConnectionSagaState.Closed);
        if (mockDataChannel.onopen) {
            mockDataChannel.onopen();
        }

        setState(ConnectionSagaState.AwaitingAnswer);

        try {
            saga.send(new Uint8Array([1, 2, 3]));
        } catch (error) {}

        try {
            saga.abort();
        } catch (error) {}

        await new Promise((resolve) => setTimeout(resolve, 200));

        function setState(state: ConnectionSagaState) {
            // @ts-ignore - Accessing private method for testing
            saga.onStateChanged?.(saga.state, state);
            Object.defineProperty(saga, 'state', {
                get: vi.fn().mockReturnValue(state),
            });
        }

        expect(mockLogger.error).toHaveBeenCalled();
    }, 10000);

    it('should handle error when sending data', () => {
        const errorSpy = vi.spyOn(mockLogger, 'error');

        const mockBrokenDataChannel: any = createMockDataChannel({
            send: vi.fn().mockImplementation(() => {
                throw new Error('Test error sending data');
            }),
        });

        const saga = getConnectionSaga(
            'mock-remote-public-key',
            'incoming',
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
            [],
        );

        const patchedSaga = Object.create(saga);
        patchedSaga.getSharedSymmetricKey = () => new Uint8Array([1, 2, 3]);
        patchedSaga.getRtcSendDataChannel = () => mockBrokenDataChannel;

        patchedSaga.send(new Uint8Array([1, 2, 3]));

        expect(errorSpy).toHaveBeenCalled();

        errorSpy.mockRestore();
    });

    it('should handle error when sending message', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'outgoing';

        const errorSpy = vi.spyOn(mockLogger, 'error');

        const mockDataChannel: any = createMockDataChannel({
            send: vi.fn().mockImplementation(() => {
                throw new Error('Test error sending data');
            }),
        });

        const saga: ConnectionSaga = {
            publicKey,
            type: connectionType,
            state: ConnectionSagaState.Connected,
            continue: vi.fn(),
            abort: vi.fn(),
            open: vi.fn().mockResolvedValue(null),
            setEncryption: vi.fn(),
            setDescription: vi.fn(),
            addIceCandidate: vi.fn(),
            send: (message) => {
                try {
                    mockDataChannel.send(message);
                } catch (error) {
                    mockLogger.error(error);
                }
            },
        };

        errorSpy.mockClear();

        saga.send(new Uint8Array([1, 2, 3]));

        expect(errorSpy).toHaveBeenCalled();

        expect(mockDataChannel.send).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));

        errorSpy.mockRestore();
    });

    it('should handle errors in state change callback', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'incoming';

        const mockDataChannel = createMockDataChannel();

        const mockPeerConnection = createMockPeerConnection({}, mockDataChannel);

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
        );

        saga.onStateChanged = () => {
            throw new Error('Test error in state change callback');
        };

        const openPromise = saga.open(ConnectionSagaState.AwaitOffer);

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(mockLogger.error).toHaveBeenCalled();

        saga.abort();
    });

    it('should throw error when accessing uninitialized peer connection', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'incoming';

        const mockWebRTC = {
            PeerConnection: vi.fn(),
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
        );

        const encryptedOfferDataBase64 = mockBase64.encode(
            mockUtf8.decode(JSON.stringify({ description: { type: 'offer', sdp: 'mock-sdp-offer' } })),
        );

        await expect(saga.setDescription(encryptedOfferDataBase64)).rejects.toThrow(
            'WebRTC peer connection is not initialized',
        );

        expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should throw error when accessing uninitialized send data channel', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'incoming';

        const mockPeerConnection = createMockPeerConnection();

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
        );

        try {
            saga.send(new Uint8Array([1, 2, 3]));
            expect('No error thrown').toBe('Expected an error to be thrown');
        } catch (error) {
            expect(mockLogger.error).toHaveBeenCalled();
        }
    });

    it('should throw error when accessing uninitialized shared symmetric key', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'incoming';

        const mockDataChannel = createMockDataChannel();

        const mockPeerConnection = createMockPeerConnection({}, mockDataChannel);

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
        );

        await saga.open(ConnectionSagaState.New);

        const encryptedDataBase64 = mockBase64.encode(
            mockUtf8.decode(JSON.stringify({ description: { type: 'offer', sdp: 'mock-sdp-offer' } })),
        );

        try {
            await saga.setDescription(encryptedDataBase64);
            expect('No error thrown').toBe('Expected an error to be thrown');
        } catch (error) {
            expect(mockLogger.error).toHaveBeenCalled();
        }
    });

    it('should throw error when continue is called without a continue callback set', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'incoming';

        const mockPeerConnection = createMockPeerConnection();

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
        );

        const errorSpy = vi.spyOn(mockLogger, 'error');

        try {
            saga.continue();
            expect('No error thrown').toBe('Expected an error to be thrown');
        } catch (error) {
            if (error instanceof Error) {
                expect(error.message).toContain('Expected to have continue callback initialized');
            } else {
                assert.fail('Expected error to be an instance of Error');
            }
            expect(errorSpy).toHaveBeenCalled();
        }

        errorSpy.mockRestore();
    });

    it('should handle message callback errors', async () => {
        const mockDataChannel = createMockDataChannel();

        const mockPeerConnection = createMockPeerConnection({}, mockDataChannel);

        const mockWebRTC = {
            PeerConnection: vi.fn(function () {
                return mockPeerConnection;
            }),
        };

        const publicKey = 'mock-message-error-public-key';
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

        const errorFn = vi.fn().mockImplementation(() => {
            throw new Error('Test message handler error');
        });

        saga.onMessage = errorFn;

        saga.setEncryption('mock-encryption-public-key');

        await saga.open(ConnectionSagaState.SendOffer);

        mockLogger.error.mockClear();

        const simulateMessageHandling = async () => {
            try {
                await new Promise<void>((resolve) => {
                    if (saga.onMessage) {
                        saga.onMessage(new Uint8Array([1, 2, 3]));
                    }
                    resolve();
                });
            } catch (err) {
                mockLogger.error(`[connection-saga] Message callback error test`, err);
            }
        };

        await simulateMessageHandling();

        expect(errorFn).toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalled();
    }, 10000);

    it('should handle invalid data formats and advanced scenarios', async () => {
        const mockDataChannel = createMockDataChannel();

        const mockPeerConnection = createMockPeerConnection({}, mockDataChannel);

        const mockWebRTC = {
            PeerConnection: vi.fn(function () {
                return mockPeerConnection;
            }),
        };

        const publicKey = 'mock-remote-public-key';
        const connectionType: ConnectionSagaType = 'incoming';

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

        const openPromise = saga.open(ConnectionSagaState.AwaitOffer);

        const invalidFormatEncryptedOfferDataBase64 = mockBase64.encode(mockUtf8.decode(JSON.stringify(null)));

        try {
            await saga.setDescription(invalidFormatEncryptedOfferDataBase64);
            assert.fail('Expected an error for invalid description format');
        } catch (error) {
            expect(error).toBeDefined();
        }

        const invalidFormatEncryptedIceDataBase64 = mockBase64.encode(mockUtf8.decode(JSON.stringify(null)));

        try {
            await saga.addIceCandidate(invalidFormatEncryptedIceDataBase64);
            assert.fail('Expected an error for invalid ICE candidate format');
        } catch (error) {
            expect(error).toBeDefined();
        }

        setState(ConnectionSagaState.SendDial);
        await new Promise((resolve) => setTimeout(resolve, 100));

        await new Promise((resolve) => setTimeout(resolve, 200));

        function setState(state: ConnectionSagaState) {
            // @ts-ignore - Accessing private method for testing
            saga.onStateChanged?.(saga.state, state);
            Object.defineProperty(saga, 'state', {
                get: vi.fn().mockReturnValue(state),
            });
        }
    }, 10000);

    it('should log error when trying to send data without initialized data channel', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'outgoing';

        const mockDataChannel = createMockDataChannel();

        const mockPeerConnection = createMockPeerConnection({}, mockDataChannel);

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

        saga.setEncryption('mock-encryption-public-key');

        saga.send(new Uint8Array([1, 2, 3]));

        expect(mockLogger.error).toHaveBeenCalledWith(
            expect.stringContaining('Error sending data in outgoing connection with mock-remote-public-key'),
        );

        saga.abort();
    });

    it('should log error when message callback fails', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'outgoing';

        const mockDataChannel = createMockDataChannel();

        const mockPeerConnection = createMockPeerConnection({}, mockDataChannel);

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

        saga.setEncryption('mock-encryption-public-key');

        const stateTransitions: ConnectionSagaState[] = [];
        saga.onStateChanged = (from, to) => {
            stateTransitions.push(to);
        };

        const openPromise = saga.open(ConnectionSagaState.SendDial);

        await new Promise((resolve) => setTimeout(resolve, 20));

        const encryptedOfferDataBase64 = mockBase64.encode(
            mockUtf8.decode(JSON.stringify({ description: { type: 'offer', sdp: 'mock-sdp-offer' } })),
        );
        await saga.setDescription(encryptedOfferDataBase64);

        if (mockPeerConnection.onicecandidate) {
            // @ts-ignore
            mockPeerConnection.onicecandidate({
                candidate: {
                    toJSON: () => ({
                        candidate: 'candidate:1 1 UDP 123456 192.168.1.1 12345 typ host',
                        sdpMid: '0',
                        sdpMLineIndex: 0,
                        usernameFragment: 'mock-username-fragment',
                    }),
                },
            });
        }

        if (mockPeerConnection.ondatachannel) {
            // @ts-ignore
            mockPeerConnection.ondatachannel({ channel: { ...mockDataChannel } });
        }

        const mockError = new Error('Test error');
        saga.onMessage = () => {
            throw mockError;
        };

        if (mockDataChannel.onopen) {
            // @ts-ignore
            mockDataChannel.onopen();
        }

        const mockMessage = new ArrayBuffer(10);
        if (mockDataChannel.onmessage) {
            // @ts-ignore
            mockDataChannel.onmessage({ data: mockMessage });
        }

        await openPromise;

        expect(mockLogger.error).toHaveBeenCalledWith(
            expect.stringContaining('Message callback error in outgoing connection with mock-remote-public-key'),
            mockError,
        );

        saga.abort();
    });

    it('should log error when closing sending DataChannel fails', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'outgoing';

        const mockError = new Error('Failed to close sending DataChannel');
        const mockDataChannel = createMockDataChannel({
            close: vi.fn().mockImplementation(() => {
                throw mockError;
            }),
        });

        const mockPeerConnection = createMockPeerConnection({}, mockDataChannel);

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

        saga.setEncryption('mock-encryption-public-key');

        const openPromise = saga.open(ConnectionSagaState.SendDial);

        await new Promise((resolve) => setTimeout(resolve, 20));

        const encryptedOfferDataBase64 = mockBase64.encode(
            mockUtf8.decode(JSON.stringify({ description: { type: 'offer', sdp: 'mock-sdp-offer' } })),
        );
        await saga.setDescription(encryptedOfferDataBase64);

        if (mockPeerConnection.onicecandidate) {
            // @ts-ignore
            mockPeerConnection.onicecandidate({
                candidate: {
                    toJSON: () => ({
                        candidate: 'candidate:1 1 UDP 123456 192.168.1.1 12345 typ host',
                        sdpMid: '0',
                        sdpMLineIndex: 0,
                        usernameFragment: 'mock-username-fragment',
                    }),
                },
            });
        }

        if (mockPeerConnection.ondatachannel) {
            // @ts-ignore
            mockPeerConnection.ondatachannel({ channel: { ...mockDataChannel } });
        }

        if (mockDataChannel.onopen) {
            // @ts-ignore
            mockDataChannel.onopen();
        }

        await openPromise;

        saga.abort();

        expect(mockLogger.error).toHaveBeenCalledWith(
            expect.stringContaining('Error closing sending DataChannel in outgoing connection'),
            mockError,
        );
    });

    it('should log error when closing receiving DataChannel fails', async () => {
        const publicKey = 'mock-remote-public-key';
        const connectionType = 'outgoing';

        const mockError = new Error('Failed to close receiving DataChannel');
        const mockDataChannel = createMockDataChannel();

        const mockReceiveDataChannel = createMockDataChannel({
            id: 'receive-data-channel-id',
            label: 'mock-receive-data-channel',
            readyState: 'connecting',
            close: vi.fn().mockImplementation(() => {
                throw mockError;
            }),
        });

        const mockPeerConnection = createMockPeerConnection({}, mockDataChannel);

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

        saga.setEncryption('mock-encryption-public-key');

        const openPromise = saga.open(ConnectionSagaState.SendDial);

        await new Promise((resolve) => setTimeout(resolve, 20));

        const encryptedOfferDataBase64 = mockBase64.encode(
            mockUtf8.decode(JSON.stringify({ description: { type: 'offer', sdp: 'mock-sdp-offer' } })),
        );
        await saga.setDescription(encryptedOfferDataBase64);

        if (mockPeerConnection.onicecandidate) {
            // @ts-ignore
            mockPeerConnection.onicecandidate({
                candidate: {
                    toJSON: () => ({
                        candidate: 'candidate:1 1 UDP 123456 192.168.1.1 12345 typ host',
                        sdpMid: '0',
                        sdpMLineIndex: 0,
                        usernameFragment: 'mock-username-fragment',
                    }),
                },
            });
        }

        if (mockPeerConnection.ondatachannel) {
            // @ts-ignore
            mockPeerConnection.ondatachannel({ channel: mockReceiveDataChannel });
        }

        if (mockDataChannel.onopen) {
            // @ts-ignore
            mockDataChannel.onopen();
        }

        await openPromise;

        saga.abort();

        expect(mockLogger.error).toHaveBeenCalledWith(
            expect.stringContaining('Error closing receiving DataChannel in outgoing connection'),
            mockError,
        );
    });
});
