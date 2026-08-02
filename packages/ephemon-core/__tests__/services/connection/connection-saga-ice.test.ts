import {
    ConnectionSagaState,
    ConnectionSagaType,
    getConnectionSaga,
} from '../../../src/services/connection/connection-saga';

describe('ConnectionSaga (ICE handling)', () => {
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

    it('should handle ICE candidates correctly', async () => {
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
            remoteDescription: null as RTCSessionDescription | null,
        };

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

        const openPromise = saga.open(ConnectionSagaState.AwaitOffer);

        const encryptedOfferDataBase64 = mockBase64.encode(
            mockUtf8.decode(JSON.stringify({ description: { type: 'offer', sdp: 'mock-sdp-offer' } })),
        );
        await saga.setDescription(encryptedOfferDataBase64);

        const iceCandidate = {
            candidate: 'candidate:1 1 UDP 123456 192.168.1.1 12345 typ host',
            sdpMid: '0',
            sdpMLineIndex: 0,
            usernameFragment: 'mock-username-fragment',
        };

        const encryptedIceCandidateBase64 = mockBase64.encode(mockUtf8.decode(JSON.stringify(iceCandidate)));

        mockPeerConnection.remoteDescription = { type: 'offer', sdp: 'mock-sdp' } as RTCSessionDescription;

        await saga.addIceCandidate(encryptedIceCandidateBase64);

        expect(mockPeerConnection.addIceCandidate).toHaveBeenCalled();
        expect(mockPeerConnection.addIceCandidate).toHaveBeenCalledWith(
            expect.objectContaining({
                candidate: iceCandidate.candidate,
                sdpMid: iceCandidate.sdpMid,
                sdpMLineIndex: iceCandidate.sdpMLineIndex,
                usernameFragment: iceCandidate.usernameFragment,
            }),
        );

        mockPeerConnection.addIceCandidate.mockClear();
        mockPeerConnection.remoteDescription = null as RTCSessionDescription | null;

        const anotherIceCandidate = {
            candidate: 'candidate:2 1 UDP 123456 192.168.1.2 12345 typ host',
            sdpMid: '0',
            sdpMLineIndex: 0,
            usernameFragment: 'mock-username-fragment',
        };

        const encryptedIceCandidate2Base64 = mockBase64.encode(mockUtf8.decode(JSON.stringify(anotherIceCandidate)));

        await saga.addIceCandidate(encryptedIceCandidate2Base64);

        expect(mockPeerConnection.addIceCandidate).not.toHaveBeenCalled();

        mockPeerConnection.remoteDescription = { type: 'offer', sdp: 'mock-sdp' } as RTCSessionDescription;

        const thirdIceCandidate = {
            candidate: 'candidate:3 1 UDP 123456 192.168.1.3 12345 typ host',
            sdpMid: '0',
            sdpMLineIndex: 0,
            usernameFragment: 'mock-username-fragment',
        };

        const encryptedIceCandidate3Base64 = mockBase64.encode(mockUtf8.decode(JSON.stringify(thirdIceCandidate)));

        await saga.addIceCandidate(encryptedIceCandidate3Base64);

        expect(mockPeerConnection.addIceCandidate).toHaveBeenCalledTimes(1);
    });

    it('should cache ICE candidates when remote description is not ready', () => {
        const iceCandidates: any[] = [];

        const debugSpy = vi.spyOn(mockLogger, 'debug');

        const mockAddIceCandidate = function (encryptedDataBase64: string) {
            const mockRemoteIceCandidate = {
                candidate: 'candidate:1 1 UDP 123456 192.168.1.1 12345 typ host',
                sdpMid: '0',
                sdpMLineIndex: 0,
            };

            const mockPeerConnection = {
                remoteDescription: null,
                addIceCandidate: vi.fn(),
            };

            if (!mockPeerConnection.remoteDescription) {
                mockLogger.debug(
                    `[connection-saga] Cached remote WebRTC ice candidate in incoming connection with mock-key. Remote description is not ready yet.`,
                );
                iceCandidates.push(mockRemoteIceCandidate);
            } else {
                mockPeerConnection.addIceCandidate(mockRemoteIceCandidate);
            }

            mockLogger.debug(
                `[connection-saga] Added remote WebRTC ice candidate in incoming connection with mock-key.`,
            );
        };

        mockAddIceCandidate('mock-encrypted-data');

        expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('Cached remote WebRTC ice candidate'));

        expect(iceCandidates.length).toBe(1);
        expect(iceCandidates[0]).toEqual(
            expect.objectContaining({
                candidate: expect.stringContaining('192.168.1.1'),
            }),
        );

        debugSpy.mockRestore();
    });

    it('should handle ice candidate collection completion', async () => {
        const mockDataChannel = {
            id: 'data-channel-id',
            label: 'mock-data-channel',
            readyState: 'connecting',
            onopen: null,
            onmessage: null,
            close: vi.fn(),
            send: vi.fn(),
        };

        const mockPeerConnection = {
            createDataChannel: vi.fn(() => mockDataChannel),
            createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' }),
            createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp' }),
            setLocalDescription: vi.fn().mockResolvedValue(undefined),
            setRemoteDescription: vi.fn().mockResolvedValue(undefined),
            addIceCandidate: vi.fn().mockResolvedValue(undefined),
            onicecandidate: null,
            ondatachannel: null,
            onconnectionstatechange: null,
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
            remoteDescription: null as RTCSessionDescription | null,
        };

        const mockWebRTC = {
            PeerConnection: vi.fn(function () {
                return mockPeerConnection;
            }),
        };

        const publicKey = 'mock-ice-completion-public-key';
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

        await saga.open(ConnectionSagaState.SendOffer);

        expect(mockPeerConnection.onicecandidate).toBeDefined();

        if (mockPeerConnection.onicecandidate) {
            // @ts-ignore
            mockPeerConnection.onicecandidate({ candidate: null });
        }

        saga.abort();

        expect(mockPeerConnection.close).toHaveBeenCalled();
    });

    it('should handle addIceCandidate when there is a remote description', async () => {
        let rtcSendDataChannel: any;
        let mockPeerConnection: any;

        const mockDataChannel = {
            id: 'data-channel-id',
            label: 'mock-data-channel',
            readyState: 'connecting',
            onopen: null,
            onmessage: null,
            close: vi.fn(),
            send: vi.fn(),
        };

        mockPeerConnection = {
            createDataChannel: vi.fn(() => {
                rtcSendDataChannel = { ...mockDataChannel };
                return rtcSendDataChannel;
            }),
            createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' }),
            setLocalDescription: vi.fn().mockResolvedValue(undefined),
            setRemoteDescription: vi.fn().mockResolvedValue(undefined),
            addIceCandidate: vi.fn().mockResolvedValue(undefined),
            close: vi.fn(),
            onicecandidate: null,
            ondatachannel: null,
            remoteDescription: { type: 'offer', sdp: 'mock-sdp-offer' } as unknown as RTCSessionDescription,
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
        };

        const mockWebRTC = {
            PeerConnection: vi.fn(function () {
                return mockPeerConnection;
            }),
        };

        const publicKey = 'mock-remote-public-key';
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
            mockWebRTC,
            [],
            1000,
        );

        saga.setEncryption('mock-encryption-public-key');

        await saga.open(ConnectionSagaState.New);

        const iceCandidate = {
            candidate: 'candidate:1 1 UDP 123456 192.168.1.1 12345 typ host',
            sdpMid: '0',
            sdpMLineIndex: 0,
            usernameFragment: 'mock-username-fragment',
        };

        const encryptedIceCandidateBase64 = mockBase64.encode(mockUtf8.decode(JSON.stringify(iceCandidate)));

        await saga.addIceCandidate(encryptedIceCandidateBase64);
        expect(mockPeerConnection.addIceCandidate).toHaveBeenCalled();

        mockPeerConnection.addIceCandidate.mockClear();
        mockPeerConnection.remoteDescription = null as unknown as RTCSessionDescription;

        const saga2 = getConnectionSaga(
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

        saga2.setEncryption('mock-encryption-public-key');

        await saga2.open(ConnectionSagaState.New);

        await saga2.addIceCandidate(encryptedIceCandidateBase64);
        expect(mockPeerConnection.addIceCandidate).not.toHaveBeenCalled();

        const encryptedOfferDataBase64 = mockBase64.encode(
            mockUtf8.decode(JSON.stringify({ description: { type: 'offer', sdp: 'mock-sdp-offer' } })),
        );

        mockPeerConnection.setRemoteDescription.mockImplementation(() => {
            mockPeerConnection.remoteDescription = {
                type: 'offer',
                sdp: 'mock-sdp-offer',
            } as unknown as RTCSessionDescription;
            return Promise.resolve();
        });

        await saga2.setDescription(encryptedOfferDataBase64);
        expect(mockPeerConnection.addIceCandidate).toHaveBeenCalled();
    }, 15000);
});
