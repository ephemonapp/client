import {
    createMockBase64,
    createMockCallService,
    createMockCryptography,
    createMockLogger,
    createMockSessionService,
    createMockTimeService,
    createMockUtf8,
    TEST_PRIME_SERVER_URL,
} from '../../../__mocks__/test-utils';
import {
    ConnectionSaga,
    ConnectionSagaState,
    getConnectionSaga,
} from '../../../src/services/connection/connection-saga';

const MAX_DISCONNECT_WAIT = 20;

describe('ConnectionSaga (transport loss)', () => {
    const mockLogger = createMockLogger();

    const flush = (milliseconds = 10) => new Promise((resolve) => setTimeout(resolve, milliseconds));

    const createMockDataChannel = () => ({
        id: 'data-channel-id',
        label: 'mock-data-channel',
        readyState: 'open',
        onopen: null as (() => void) | null,
        onmessage: null as ((event: unknown) => void) | null,
        onclose: null as (() => void) | null,
        onerror: null as ((event: unknown) => void) | null,
        close: vi.fn(),
        send: vi.fn(),
    });

    type MockDataChannel = ReturnType<typeof createMockDataChannel>;

    const createMockPeerConnection = (dataChannel: MockDataChannel) => ({
        connectionState: 'connected' as RTCPeerConnectionState,
        iceConnectionState: 'connected' as RTCIceConnectionState,
        createDataChannel: vi.fn(() => dataChannel),
        createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' }),
        createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp' }),
        setLocalDescription: vi.fn().mockResolvedValue(undefined),
        setRemoteDescription: vi.fn().mockResolvedValue(undefined),
        addIceCandidate: vi.fn().mockResolvedValue(undefined),
        onicecandidate: null as ((event: unknown) => void) | null,
        ondatachannel: null as ((event: unknown) => void) | null,
        onconnectionstatechange: null as (() => void) | null,
        oniceconnectionstatechange: null as (() => void) | null,
        close: vi.fn(),
        getStats: vi.fn().mockResolvedValue(
            new Map<string, any>([
                ['candidate-pair-id', { type: 'candidate-pair', selected: true, localCandidateId: 'local-id' }],
                ['local-id', { candidateType: 'host', address: '192.168.1.1' }],
            ]),
        ),
        remoteDescription: null as RTCSessionDescription | null,
    });

    type MockPeerConnection = ReturnType<typeof createMockPeerConnection>;

    const buildSaga = (maxStepWait = 60 * 1000) => {
        const dataChannels = [createMockDataChannel()];
        const peerConnections = dataChannels.map(createMockPeerConnection);
        let created = 0;
        const mockWebRTC = {
            PeerConnection: vi.fn(function () {
                return peerConnections[created++];
            }),
        };
        const saga = getConnectionSaga(
            'mock-remote-public-key',
            'outgoing',
            mockLogger,
            createMockTimeService(),
            () => createMockCallService(),
            () => TEST_PRIME_SERVER_URL,
            createMockSessionService(),
            createMockBase64(),
            createMockUtf8(),
            createMockCryptography(),
            // @ts-ignore
            mockWebRTC,
            [],
            maxStepWait,
            MAX_DISCONNECT_WAIT,
        );
        return { saga, peerConnections, dataChannels };
    };

    const connect = async (saga: ConnectionSaga, dataChannel: MockDataChannel) => {
        const openPromise = saga.open(ConnectionSagaState.AwaitConnection);
        await flush();
        dataChannel.onopen!();
        await openPromise;
        expect(saga.state).toBe(ConnectionSagaState.Connected);
    };

    const fire = (peerConnection: MockPeerConnection, source: 'connectionState' | 'iceConnectionState') => {
        if (source === 'connectionState') {
            peerConnection.onconnectionstatechange!();
        } else {
            peerConnection.oniceconnectionstatechange!();
        }
    };

    const debugContaining = (fragment: string) =>
        mockLogger.debug.mock.calls.filter(([message]: Array<unknown>) => `${message}`.includes(fragment));

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(mockLogger.error).not.toHaveBeenCalled();
    });

    const lossCases: Array<{ source: 'connectionState' | 'iceConnectionState'; value: string }> = [
        { source: 'connectionState', value: 'failed' },
        { source: 'connectionState', value: 'closed' },
        { source: 'iceConnectionState', value: 'failed' },
    ];

    for (const { source, value } of lossCases) {
        it(`should close a connected saga when ${source} becomes ${value}`, async () => {
            const { saga, peerConnections, dataChannels } = buildSaga();
            const [peerConnection] = peerConnections;
            await connect(saga, dataChannels[0]);

            if (source === 'connectionState') {
                peerConnection.connectionState = value as RTCPeerConnectionState;
            } else {
                peerConnection.iceConnectionState = value as RTCIceConnectionState;
            }
            fire(peerConnection, source);

            expect(saga.state).toBe(ConnectionSagaState.Closed);
            expect(peerConnection.close).toHaveBeenCalled();
            expect(debugContaining(`Transport lost (${source}='${value}')`)).toHaveLength(1);
        });
    }

    it('should close a connected saga when the disconnected state does not recover', async () => {
        const { saga, peerConnections, dataChannels } = buildSaga();
        const [peerConnection] = peerConnections;
        await connect(saga, dataChannels[0]);

        peerConnection.connectionState = 'disconnected';
        fire(peerConnection, 'connectionState');
        fire(peerConnection, 'connectionState');

        expect(saga.state).toBe(ConnectionSagaState.Connected);
        expect(debugContaining(`Awaiting up to ${MAX_DISCONNECT_WAIT}ms`)).toHaveLength(1);

        await flush(MAX_DISCONNECT_WAIT + 10);

        expect(saga.state).toBe(ConnectionSagaState.Closed);
        expect(debugContaining(`for more than ${MAX_DISCONNECT_WAIT}ms`)).toHaveLength(1);
    });

    for (const value of ['connected', 'completed'] as Array<RTCIceConnectionState>) {
        it(`should keep a connected saga when the transport recovers to ${value}`, async () => {
            const { saga, peerConnections, dataChannels } = buildSaga();
            const [peerConnection] = peerConnections;
            await connect(saga, dataChannels[0]);

            peerConnection.iceConnectionState = 'disconnected';
            fire(peerConnection, 'iceConnectionState');
            peerConnection.iceConnectionState = value;
            fire(peerConnection, 'iceConnectionState');

            await flush(MAX_DISCONNECT_WAIT + 10);

            expect(saga.state).toBe(ConnectionSagaState.Connected);
            expect(debugContaining('Transport lost')).toHaveLength(0);
        });
    }

    it('should ignore transport states that carry no verdict', async () => {
        const { saga, peerConnections, dataChannels } = buildSaga();
        const [peerConnection] = peerConnections;
        await connect(saga, dataChannels[0]);

        peerConnection.iceConnectionState = 'checking';
        fire(peerConnection, 'iceConnectionState');

        await flush(MAX_DISCONNECT_WAIT + 10);

        expect(saga.state).toBe(ConnectionSagaState.Connected);
    });

    it('should ignore transport loss reported before the saga is connected', async () => {
        const { saga, peerConnections } = buildSaga(30);
        const openPromise = saga.open(ConnectionSagaState.AwaitConnection);
        await flush();
        const [peerConnection] = peerConnections;

        peerConnection.connectionState = 'failed';
        fire(peerConnection, 'connectionState');

        expect(saga.state).toBe(ConnectionSagaState.AwaitingConnection);
        expect(mockLogger.debug).toHaveBeenCalledWith(
            expect.stringContaining(`Transport loss (connectionState='failed') ignored`),
        );
        expect(peerConnection.close).not.toHaveBeenCalled();

        await openPromise;
    });

    for (const suffix of ['send', 'receive'] as const) {
        it(`should close a connected saga when the ${suffix} data channel closes`, async () => {
            const { saga, peerConnections, dataChannels } = buildSaga();
            const [peerConnection] = peerConnections;
            const [sendDataChannel] = dataChannels;
            await connect(saga, sendDataChannel);

            const receiveDataChannel = createMockDataChannel();
            peerConnection.ondatachannel!({ channel: receiveDataChannel });
            const dataChannel = suffix === 'send' ? sendDataChannel : receiveDataChannel;

            dataChannel.onclose!();

            expect(saga.state).toBe(ConnectionSagaState.Closed);
            expect(
                debugContaining(`Transport lost (${suffix} dataChannel with label '${dataChannel.label}' closed)`),
            ).toHaveLength(1);
        });
    }

    it('should close a connected saga when the data channel reports an error', async () => {
        const { saga, dataChannels } = buildSaga();
        const [dataChannel] = dataChannels;
        await connect(saga, dataChannel);

        const event = { type: 'error' };
        dataChannel.onerror!(event);

        expect(saga.state).toBe(ConnectionSagaState.Closed);
        expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining(`${dataChannel.label}' failed`), event);
        expect(debugContaining('Transport lost')).toHaveLength(1);
    });

    it('should drop the pending grace period when the saga is aborted', async () => {
        const { saga, peerConnections, dataChannels } = buildSaga();
        const [peerConnection] = peerConnections;
        await connect(saga, dataChannels[0]);

        peerConnection.iceConnectionState = 'disconnected';
        fire(peerConnection, 'iceConnectionState');
        saga.abort();

        await flush(MAX_DISCONNECT_WAIT + 10);

        expect(debugContaining('Transport lost')).toHaveLength(0);
        expect(debugContaining('Transport loss')).toHaveLength(0);
    });
});
