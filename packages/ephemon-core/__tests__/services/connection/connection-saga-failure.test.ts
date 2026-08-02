import {
    createMockCallService,
    createMockCryptography,
    createMockDataChannel,
    createMockLogger,
    createMockPeerConnection,
    createMockSessionService,
    createMockTimeService,
    TEST_PRIME_SERVER_URL,
} from '../../../__mocks__/test-utils';
import { ConnectionError } from '../../../src/services/connection/connection-error';
import { ConnectionSagaState, getConnectionSaga } from '../../../src/services/connection/connection-saga';
import { WebRTC } from '../../../src/services/connection/web-rtc';
import { getBase64 } from '../../../src/utils/base64';
import { newCallError } from '../../../src/utils/call-error';
import { getUtf8 } from '../../../src/utils/utf8';

const PUBLIC_KEY = 'peer-public-key';
const PEER_SERVER_URL = 'http://127.0.0.1:5028';

const base64 = getBase64();
const utf8 = getUtf8();
const PEER_ENCRYPTION_KEY = base64.encode(new Uint8Array(32).fill(9));

describe('ConnectionSaga failures', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let mockCallService: ReturnType<typeof createMockCallService>;
    let mockPeerConnection: ReturnType<typeof createMockPeerConnection>;
    let mockWebRTC: WebRTC;

    function build(type: 'incoming' | 'outgoing' = 'outgoing') {
        return getConnectionSaga(
            PUBLIC_KEY,
            type,
            mockLogger as any,
            createMockTimeService() as any,
            () => mockCallService as any,
            () => TEST_PRIME_SERVER_URL,
            createMockSessionService() as any,
            base64 as any,
            utf8 as any,
            createMockCryptography() as any,
            mockWebRTC,
            [],
            1000,
        );
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mockLogger = createMockLogger();
        mockCallService = createMockCallService();
        mockPeerConnection = createMockPeerConnection({}, createMockDataChannel());
        mockWebRTC = {
            PeerConnection: vi.fn(function () {
                return mockPeerConnection;
            }),
            DataChannel: vi.fn(),
        } as unknown as WebRTC;
    });

    it('gives the attempt up and reports the refusal the server sent', async () => {
        mockCallService.dial.mockRejectedValueOnce(
            newCallError(mockLogger as any, 'refused', PEER_SERVER_URL, 'Account is not reachable'),
        );
        const saga = build();
        const failures: ConnectionError[] = [];
        saga.onFailed = (error) => failures.push(error);

        await saga.open(ConnectionSagaState.SendDial);

        expect(failures).toEqual([{ issue: 'peer-unreachable', serverUrl: PEER_SERVER_URL }]);
        expect(saga.state).toBe(ConnectionSagaState.New);
    });

    it('reports what little it knows when the failure carries no details', async () => {
        mockCallService.dial.mockRejectedValueOnce(new Error('opaque'));
        const saga = build();
        const failures: ConnectionError[] = [];
        saga.onFailed = (error) => failures.push(error);

        await saga.open(ConnectionSagaState.SendDial);

        expect(failures).toEqual([{ issue: 'signalling-unavailable' }]);
        expect(saga.state).toBe(ConnectionSagaState.New);
    });

    it('survives a missing failure listener', async () => {
        mockCallService.dial.mockRejectedValueOnce(new Error('opaque'));
        const saga = build();

        await expect(saga.open(ConnectionSagaState.SendDial)).resolves.toBe(saga);
    });

    it('logs a failure listener that throws', async () => {
        mockCallService.dial.mockRejectedValueOnce(new Error('opaque'));
        const saga = build();
        saga.onFailed = () => {
            throw new Error('boom');
        };

        await saga.open(ConnectionSagaState.SendDial);

        expect(mockLogger.error).toHaveBeenCalledWith(
            `[connection-saga] Failure callback error in outgoing connection with ${PUBLIC_KEY}.`,
            expect.any(Error),
        );
    });

    it('keeps a connection that works when the transport cannot be resolved', async () => {
        const saga = build('incoming');
        saga.setEncryption(PEER_ENCRYPTION_KEY);
        mockPeerConnection.getStats = vi.fn().mockRejectedValue(new Error('no stats'));

        const opened = saga.open(ConnectionSagaState.AwaitConnection);
        await Promise.resolve();
        saga.continue();
        await opened;

        expect(saga.state).toBe(ConnectionSagaState.Connected);
        expect(saga.transport).toBeUndefined();
        expect(mockLogger.warn).toHaveBeenCalledWith(
            `[connection-saga] Unable to resolve the transport in incoming connection with ${PUBLIC_KEY}.`,
            expect.any(Error),
        );
    });

    it('passes on the server the peer disclosed with its description', async () => {
        const saga = build('outgoing');
        saga.setEncryption(PEER_ENCRYPTION_KEY);
        const disclosed: string[] = [];
        saga.onPeerServerUrl = (serverUrl) => disclosed.push(serverUrl);
        void saga.open(ConnectionSagaState.AwaitOffer);
        await Promise.resolve();

        await saga.setDescription(
            base64.encode(
                utf8.decode(
                    JSON.stringify({
                        serverUrl: PEER_SERVER_URL,
                        description: { type: 'offer', sdp: 'mock-sdp' },
                    }),
                ),
            ),
        );

        expect(disclosed).toEqual([PEER_SERVER_URL]);
        expect(mockPeerConnection.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'mock-sdp' });
    });
});
