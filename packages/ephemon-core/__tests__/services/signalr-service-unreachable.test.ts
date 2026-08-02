import { createMockLogger } from '../../__mocks__/test-utils';
import { CallData } from '../../src/models/infrasctructure/call-data';
import { CallMethodName } from '../../src/models/infrasctructure/call-method-name';
import { CallRequest } from '../../src/models/infrasctructure/call-request';
import { getSignalRService, SignalRService } from '../../src/services/signalr-service';
import { HubConnection, HubConnectionBuilder } from '@microsoft/signalr';

vi.mock('@microsoft/signalr');

const SERVER_URL = 'https://refuses.ephemon.test';
const READY_TIMEOUT = 100;
const REQUEST: CallRequest<CallData> = {
    a: 'dial' as CallMethodName,
    b: { a: 'public-key' },
    c: 'signature',
};

describe('SignalRService against a server that will not let us in', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let hub: Mocked<HubConnection>;
    let service: SignalRService;

    function config(overrides: any = {}) {
        return {
            serverUrl: SERVER_URL,
            onCall: vi.fn().mockResolvedValue(undefined),
            onReady: vi.fn().mockResolvedValue(undefined),
            initializationTimeout: 10,
            readyTimeout: READY_TIMEOUT,
            ...overrides,
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        mockLogger = createMockLogger();
        service = getSignalRService(mockLogger as any);
        hub = new HubConnectionBuilder().build() as Mocked<HubConnection>;
        hub.start.mockRejectedValue(new Error('Failed to fetch'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('never becomes ready', async () => {
        await vi.advanceTimersByTimeAsync(0);
        const initialized = service.initialize(config());
        await vi.advanceTimersByTimeAsync(10);
        await initialized;

        expect(service.ready).toBe(false);
    });

    it('fails a call instead of leaving it pending forever', async () => {
        const initialized = service.initialize(config());
        await vi.advanceTimersByTimeAsync(10);
        await initialized;

        const call = service.call(REQUEST);
        const assertion = expect(call).rejects.toMatchObject({
            message: `[signalr-service] Connection to ${SERVER_URL} did not become ready within ${READY_TIMEOUT}ms.`,
            serverUrl: SERVER_URL,
            reason: undefined,
        });
        await vi.advanceTimersByTimeAsync(READY_TIMEOUT);
        await assertion;
    });

    it('keeps retrying until it is told to stop', async () => {
        const initialized = service.initialize(config());
        await vi.advanceTimersByTimeAsync(10);
        await initialized;
        const attemptsBefore = hub.start.mock.calls.length;

        await vi.advanceTimersByTimeAsync(5000);
        expect(hub.start.mock.calls.length).toBeGreaterThan(attemptsBefore);

        await service.stop();
        const attemptsAtStop = hub.start.mock.calls.length;
        await vi.advanceTimersByTimeAsync(30_000);

        expect(hub.start.mock.calls.length).toBe(attemptsAtStop);
        expect(hub.stop).toHaveBeenCalledTimes(1);
        expect(mockLogger.debug).toHaveBeenCalledWith(`[signalr-service] Connection to ${SERVER_URL} stopped.`);
    });

    it('does not schedule a retry for an attempt that fails after it was stopped', async () => {
        let rejectStart: (error: Error) => void = () => {};
        hub.start.mockImplementationOnce(
            () =>
                new Promise<void>((_resolve, reject) => {
                    rejectStart = reject;
                }),
        );
        const initialized = service.initialize(config());
        await vi.advanceTimersByTimeAsync(10);
        await initialized;

        await service.stop();
        rejectStart(new Error('Failed to fetch'));
        await vi.advanceTimersByTimeAsync(30_000);

        expect(hub.start).toHaveBeenCalledTimes(1);
    });

    it('reports a hub that will not stop cleanly and carries on', async () => {
        const initialized = service.initialize(config());
        await vi.advanceTimersByTimeAsync(10);
        await initialized;
        hub.stop.mockRejectedValueOnce(new Error('already gone'));

        await expect(service.stop()).resolves.toBeUndefined();

        expect(mockLogger.warn).toHaveBeenCalledWith(
            `[signalr-service] Error while stopping the connection to ${SERVER_URL}.`,
            expect.any(Error),
        );
    });

    it('fails a call when it was never initialized', async () => {
        const fresh = getSignalRService(mockLogger as any);

        await expect(fresh.call(REQUEST)).rejects.toMatchObject({
            message: '[signalr-service] SignalR connection is not initialized.',
            serverUrl: undefined,
        });
    });
});

describe('SignalRService against a server that answers', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let hub: Mocked<HubConnection>;
    let service: SignalRService;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockLogger = createMockLogger();
        service = getSignalRService(mockLogger as any);
        hub = new HubConnectionBuilder().build() as Mocked<HubConnection>;
        hub.start.mockResolvedValue(undefined);
        await service.initialize({
            serverUrl: SERVER_URL,
            onCall: vi.fn().mockResolvedValue(undefined),
            onReady: vi.fn().mockResolvedValue(undefined),
            initializationTimeout: 10,
            readyTimeout: READY_TIMEOUT,
        });
    });

    it('passes the refusal the server reported', async () => {
        hub.invoke.mockResolvedValueOnce({ ok: false, timestamp: 1, reason: 'Account is not reachable' });

        await expect(service.call(REQUEST)).rejects.toMatchObject({
            serverUrl: SERVER_URL,
            reason: 'Account is not reachable',
        });
    });

    it('reports an answer it cannot read as unreachable rather than refused', async () => {
        hub.invoke.mockResolvedValueOnce(undefined as any);

        await expect(service.call(REQUEST)).rejects.toMatchObject({
            message: `[signalr-service] Unexpected answer on call dial from ${SERVER_URL}.`,
            serverUrl: SERVER_URL,
            reason: undefined,
        });
    });
});
