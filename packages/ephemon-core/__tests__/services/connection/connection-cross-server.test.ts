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
import { getConnection, translateConnection } from '../../../src/services/connection/connection';
import { ConnectionError } from '../../../src/services/connection/connection-error';
import {
    ConnectionSaga,
    ConnectionSagaState,
    getConnectionSaga,
} from '../../../src/services/connection/connection-saga';
import { WebRTC } from '../../../src/services/connection/web-rtc';
import { newCallError } from '../../../src/utils/call-error';

const PEER_SERVER_URL = 'http://127.0.0.1:5028';
const SERVER_URL_WAIT = 1000;

type FakeSaga = ConnectionSaga & { state: ConnectionSagaState; open: Mock };

const sagas: Record<string, FakeSaga> = {};

vi.mock('../../../src/services/connection/connection-saga', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../src/services/connection/connection-saga')>();
    return {
        ...original,
        getConnectionSaga: vi.fn(),
    };
});

describe('Connection (cross-server)', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let prime: ReturnType<typeof createMockCallService>;
    let peer: ReturnType<typeof createMockCallService>;
    let factory: ReturnType<typeof createMockCallServiceFactory>;

    function build(serverUrl?: string) {
        return getConnection(
            'peer-public-key',
            mockLogger as any,
            createMockTimeService() as any,
            factory as any,
            createMockSessionService() as any,
            createMockBase64() as any,
            createMockUtf8() as any,
            createMockCryptography() as any,
            { PeerConnection: vi.fn(), DataChannel: vi.fn() } as unknown as WebRTC,
            [],
            serverUrl,
            SERVER_URL_WAIT,
        );
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        mockLogger = createMockLogger();
        prime = createMockCallService();
        peer = createMockCallService();
        factory = createMockCallServiceFactory(prime);
        factory.getForServerUrl = vi.fn(async (serverUrl?: string) =>
            serverUrl === PEER_SERVER_URL ? peer : (prime as any),
        );

        vi.mocked(getConnectionSaga).mockImplementation(((publicKey: string, type: string) => {
            const saga = {
                publicKey,
                type,
                state: ConnectionSagaState.New,
                transport: undefined,
                open: vi.fn(async function (this: FakeSaga, state: ConnectionSagaState) {
                    this.state = state;
                    return this;
                }),
                abort: vi.fn(),
                continue: vi.fn(),
                send: vi.fn(),
                setEncryption: vi.fn(),
                setDescription: vi.fn(),
                addIceCandidate: vi.fn(),
            } as unknown as FakeSaga;
            sagas[type] = saga;
            return saga;
        }) as any);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('the peer server URL', () => {
        it('is exposed when it came from a contact code', () => {
            expect(build(PEER_SERVER_URL).serverUrl).toBe(PEER_SERVER_URL);
            expect(build().serverUrl).toBeUndefined();
        });

        it('is learned from what a saga heard from the peer', () => {
            const connection = build();
            const changed: string[] = [];
            connection.onServerUrlChanged = (value) => changed.push(value);

            sagas.incoming.onPeerServerUrl?.(PEER_SERVER_URL);

            expect(connection.serverUrl).toBe(PEER_SERVER_URL);
            expect(changed).toEqual([PEER_SERVER_URL]);
        });

        it.each([
            ['the same value', PEER_SERVER_URL],
            ['an empty value', ''],
        ])('is not reported again for %s', (_name, value) => {
            const connection = build(PEER_SERVER_URL);
            const changed: string[] = [];
            connection.onServerUrlChanged = (url) => changed.push(url);

            connection.setServerUrl(value);

            expect(changed).toEqual([]);
        });

        it('survives a missing listener', () => {
            const connection = build();
            expect(() => connection.setServerUrl(PEER_SERVER_URL)).not.toThrow();
            expect(connection.serverUrl).toBe(PEER_SERVER_URL);
        });

        it('logs a listener that throws', async () => {
            const connection = build();
            connection.onServerUrlChanged = () => {
                throw new Error('boom');
            };

            connection.setServerUrl(PEER_SERVER_URL);
            await vi.runAllTicks();

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Server URL callback error'),
                expect.any(Error),
            );
        });
    });

    describe('opening outgoing', () => {
        it('dials through the server the contact pointed at', async () => {
            const connection = build(PEER_SERVER_URL);

            await connection.openOutgoing();

            expect(factory.getForServerUrl).toHaveBeenCalledWith(PEER_SERVER_URL);
            expect(sagas.outgoing.state).toBe(ConnectionSagaState.SendDial);
            expect(sagas.incoming.state).toBe(ConnectionSagaState.AwaitDial);
        });

        it('falls back to the prime server when no contact server is known', async () => {
            const connection = build();

            await connection.openOutgoing();

            expect(factory.getForServerUrl).toHaveBeenCalledWith(undefined);
        });
    });

    describe('opening incoming', () => {
        it('routes both directions through our own server, whatever the peer server is', async () => {
            const connection = build(PEER_SERVER_URL);

            await connection.openIncoming();

            expect(factory.getForServerUrl).toHaveBeenCalledWith(undefined);
            expect(factory.getForServerUrl).not.toHaveBeenCalledWith(PEER_SERVER_URL);
            expect(sagas.incoming.state).toBe(ConnectionSagaState.SendOffer);
            expect(sagas.outgoing.state).toBe(ConnectionSagaState.SendDial);
        });

        it('does not wait for the peer to disclose its server', async () => {
            const connection = build();

            await connection.openIncoming();

            expect(sagas.outgoing.state).toBe(ConnectionSagaState.SendDial);
        });
    });

    describe('when the peer server refuses us', () => {
        beforeEach(() => {
            factory.getForServerUrl = vi.fn(async () => {
                throw newCallError(mockLogger as any, 'nope', PEER_SERVER_URL);
            });
        });

        it('reports which server refused and opens neither direction', async () => {
            const connection = build(PEER_SERVER_URL);
            const errors: ConnectionError[] = [];
            connection.onError = (error) => errors.push(error);

            await connection.openOutgoing();

            expect(errors).toEqual([{ issue: 'signalling-unavailable', serverUrl: PEER_SERVER_URL }]);
            expect(connection.error).toEqual({ issue: 'signalling-unavailable', serverUrl: PEER_SERVER_URL });
            expect(sagas.outgoing.open).not.toHaveBeenCalled();
            expect(sagas.incoming.open).not.toHaveBeenCalled();
        });

        it('reports nothing it cannot tell when the failure is opaque', async () => {
            factory.getForServerUrl = vi.fn(async () => {
                throw new Error('opaque');
            });
            const connection = build(PEER_SERVER_URL);

            await connection.openOutgoing();

            expect(connection.error).toEqual({ issue: 'signalling-unavailable' });
        });

        it('survives a missing listener and logs one that throws', async () => {
            const connection = build(PEER_SERVER_URL);
            await connection.openOutgoing();
            expect(connection.error).toBeDefined();

            const other = build(PEER_SERVER_URL);
            other.onError = () => {
                throw new Error('boom');
            };
            await other.openOutgoing();
            await vi.runAllTicks();

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failure callback error'),
                expect.any(Error),
            );
        });
    });

    describe('a failure a saga reports', () => {
        it('is passed on with the reason the server gave', async () => {
            const connection = build(PEER_SERVER_URL);
            await connection.openOutgoing();

            sagas.outgoing.onFailed?.({ issue: 'peer-unreachable', serverUrl: PEER_SERVER_URL });

            expect(connection.error).toEqual({ issue: 'peer-unreachable', serverUrl: PEER_SERVER_URL });
        });

        it('is forgotten once a saga connects', async () => {
            const connection = build(PEER_SERVER_URL);
            await connection.openOutgoing();
            sagas.outgoing.onFailed?.({ issue: 'signalling-unavailable', serverUrl: PEER_SERVER_URL });
            expect(connection.error).toBeDefined();

            sagas.outgoing.state = ConnectionSagaState.Connected;
            sagas.outgoing.onStateChanged?.(ConnectionSagaState.AwaitingConnection, ConnectionSagaState.Connected);

            expect(connection.error).toBeUndefined();
        });
    });

    describe('an attempt that is abandoned mid-flight', () => {
        it('does not open anything after the connection was reopened', async () => {
            let releaseStale: (value: any) => void = () => {};
            factory.getForServerUrl = vi
                .fn()
                .mockImplementationOnce(() => new Promise((resolve) => (releaseStale = resolve)))
                .mockImplementation(async () => peer);

            const connection = build(PEER_SERVER_URL);
            const stale = connection.openIncoming();

            await connection.openOutgoing();
            const opensAfterReopen = sagas.outgoing.open.mock.calls.length;
            releaseStale(prime);
            await stale;

            expect(sagas.outgoing.open.mock.calls.length).toBe(opensAfterReopen);
            expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('abandoned'));
        });
    });

    describe('the accessors handed to each saga', () => {
        it('hand both directions the same service and disclose our own server', async () => {
            const connection = build(PEER_SERVER_URL);
            const calls = vi.mocked(getConnectionSaga).mock.calls as any[];
            const [, incomingType, , , incomingCallService, getOwnServerUrl] = calls[0];
            const [, outgoingType, , , outgoingCallService] = calls[1];

            expect([incomingType, outgoingType]).toEqual(['incoming', 'outgoing']);
            expect(getOwnServerUrl()).toBe(TEST_PRIME_SERVER_URL);
            expect(incomingCallService()).toBe(prime);
            expect(outgoingCallService()).toBe(prime);

            await connection.openOutgoing();

            expect(incomingCallService()).toBe(peer);
            expect(outgoingCallService()).toBe(peer);
        });
    });

    describe('the translated connection', () => {
        it('proxies the peer server URL and the failure through', async () => {
            const internal = build(PEER_SERVER_URL);
            const external = translateConnection(internal);
            const changed: string[] = [];
            const errors: ConnectionError[] = [];

            external.onServerUrlChanged = (value) => changed.push(value);
            external.onError = (error) => errors.push(error);

            expect(external.serverUrl).toBe(PEER_SERVER_URL);
            expect(external.onServerUrlChanged).toBe(internal.onServerUrlChanged);
            expect(external.onError).toBe(internal.onError);

            internal.setServerUrl('https://moved.ephemon.test');
            sagas.outgoing.onFailed?.({ issue: 'signalling-rejected', serverUrl: PEER_SERVER_URL });

            expect(changed).toEqual(['https://moved.ephemon.test']);
            expect(errors).toEqual([{ issue: 'signalling-rejected', serverUrl: PEER_SERVER_URL }]);
            expect(external.error).toEqual({ issue: 'signalling-rejected', serverUrl: PEER_SERVER_URL });
        });
    });

    describe('closing', () => {
        it('goes through the server the peer is registered on', async () => {
            const connection = build(PEER_SERVER_URL);
            await connection.openOutgoing();

            connection.close();

            expect(peer.close).toHaveBeenCalledTimes(1);
            expect(prime.close).not.toHaveBeenCalled();
        });

        it('falls back to the prime server before anything was resolved', () => {
            build(PEER_SERVER_URL).close();

            expect(prime.close).toHaveBeenCalledTimes(1);
        });
    });
});
