import {
    createMockBase64,
    createMockCallService,
    createMockCryptography,
    createMockLogger,
    createMockNavigator,
    createMockSessionService,
    createMockTimeService,
    createMockUtf8,
} from '../../__mocks__/test-utils';
import { CallPayload } from '../../src/models/infrasctructure/call-payload';
import { getCallService } from '../../src/services/call-service';
import { CallServiceFactory, getCallServiceFactory } from '../../src/services/call-service-factory';
import { getSignalRService } from '../../src/services/signalr-service';
import { getTimeService } from '../../src/services/time-service';
import { ApiClient } from '../../src/utils/api-client';

vi.mock('../../src/services/call-service');
vi.mock('../../src/services/signalr-service');
vi.mock('../../src/services/time-service');

const PRIME_URL = 'https://prime.ephemon.test';
const GUEST_URL = 'https://guest.ephemon.test';
const UPDATE_INTERVAL = 60_000;

function createMockSignalRService(ready = true) {
    return {
        initialize: vi.fn(async (config: any) => {
            if (ready) await config.onReady();
        }),
        get ready() {
            return ready;
        },
        stop: vi.fn(async () => {}),
        call: vi.fn(),
    };
}

describe('CallServiceFactory', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;
    let prime: ReturnType<typeof createMockCallService>;
    let guest: ReturnType<typeof createMockCallService>;
    let signalR: ReturnType<typeof createMockSignalRService>;
    let guestTimeService: ReturnType<typeof createMockTimeService>;
    let sessionService: ReturnType<typeof createMockSessionService>;
    let onCall: Mock;
    let factory: CallServiceFactory;

    function initialize(overrides: any = {}) {
        factory.initialize({
            serverUrl: PRIME_URL,
            navigator: createMockNavigator({ sendBeacon: vi.fn() }) as unknown as Navigator,
            prime: prime as any,
            onCall: onCall as any,
            initializationTimeout: 5000,
            updateInterval: UPDATE_INTERVAL,
            readyTimeout: 10_000,
            ...overrides,
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        mockLogger = createMockLogger();
        prime = createMockCallService();
        guest = createMockCallService();
        signalR = createMockSignalRService();
        guestTimeService = createMockTimeService();
        sessionService = createMockSessionService();
        onCall = vi.fn(async () => {});
        vi.mocked(getCallService).mockReturnValue(guest as any);
        vi.mocked(getSignalRService).mockReturnValue(signalR as any);
        vi.mocked(getTimeService).mockReturnValue(guestTimeService as any);
        factory = getCallServiceFactory(
            mockLogger as any,
            sessionService as any,
            {} as ApiClient,
            createMockBase64() as any,
            createMockUtf8() as any,
            createMockCryptography() as any,
        );
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('before initialization', () => {
        it('refuses to hand out anything', () => {
            expect(() => factory.prime).toThrow(/has not been initialized yet/);
            expect(() => factory.primeServerUrl).toThrow(/has not been initialized yet/);
            expect(() => factory.getForServerUrl(GUEST_URL)).toThrow(/has not been initialized yet/);
        });
    });

    describe('primeServerUrl', () => {
        it('is normalized', () => {
            initialize({ serverUrl: `  ${PRIME_URL}//  ` });
            expect(factory.primeServerUrl).toBe(PRIME_URL);
        });

        it('is undefined when the messenger was configured without a server', () => {
            initialize({ serverUrl: undefined });
            expect(factory.primeServerUrl).toBeUndefined();
        });
    });

    describe('getForServerUrl', () => {
        beforeEach(() => initialize());

        it.each([undefined, '', PRIME_URL, `${PRIME_URL}/`, `  ${PRIME_URL}  `])(
            'hands out the prime service for %s',
            async (serverUrl) => {
                await expect(factory.getForServerUrl(serverUrl)).resolves.toBe(prime);
                expect(getSignalRService).not.toHaveBeenCalled();
            },
        );

        it('treats every server as a guest when there is no prime URL', async () => {
            initialize({ serverUrl: undefined });
            await expect(factory.getForServerUrl(PRIME_URL)).resolves.toBe(guest);
        });

        it('brings a guest up with the http fallback disabled and its own clock', async () => {
            await expect(factory.getForServerUrl(GUEST_URL)).resolves.toBe(guest);

            expect(getTimeService).toHaveBeenCalledTimes(1);
            expect(vi.mocked(getCallService).mock.calls[0][1]).toBe(guestTimeService);
            expect(guest.initialize).toHaveBeenCalledWith(
                expect.objectContaining({ serverUrl: GUEST_URL, allowApiFallback: false }),
            );
            expect(signalR.initialize).toHaveBeenCalledWith(
                expect.objectContaining({
                    serverUrl: GUEST_URL,
                    initializationTimeout: 5000,
                    readyTimeout: 10_000,
                }),
            );
        });

        it('announces the guest without a push subscription on every ready', async () => {
            await factory.getForServerUrl(GUEST_URL);

            const { onReady } = vi.mocked(signalR.initialize).mock.calls[0][0] as any;
            expect(guest.update).toHaveBeenCalledTimes(1);
            expect(guest.update).toHaveBeenCalledWith(sessionService.signingPublicKeyBase64);

            await onReady();
            expect(guest.update).toHaveBeenCalledTimes(2);
            expect(guest.update).toHaveBeenLastCalledWith(sessionService.signingPublicKeyBase64);
        });

        it('keeps announcing the guest on an interval', async () => {
            await factory.getForServerUrl(GUEST_URL);
            expect(guest.update).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL);
            expect(guest.update).toHaveBeenCalledTimes(2);

            await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL);
            expect(guest.update).toHaveBeenCalledTimes(3);
        });

        it('logs an interval update that fails instead of leaving it unhandled', async () => {
            await factory.getForServerUrl(GUEST_URL);
            guest.update.mockRejectedValueOnce(new Error('boom'));

            await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL);

            expect(mockLogger.error).toHaveBeenCalledWith(
                `[call-service-factory] Error while updating the guest of ${GUEST_URL}.`,
                expect.any(Error),
            );
        });

        it('routes calls arriving over a guest with that guest clock', async () => {
            await factory.getForServerUrl(GUEST_URL);

            const config = vi.mocked(signalR.initialize).mock.calls[0][0] as any;
            const payload = { a: 'dial' } as CallPayload;
            await config.onCall(payload);

            expect(onCall).toHaveBeenCalledWith(payload, guestTimeService);
        });

        it('reuses a guest that is already up', async () => {
            const first = await factory.getForServerUrl(GUEST_URL);
            const second = await factory.getForServerUrl(`${GUEST_URL}/`);

            expect(second).toBe(first);
            expect(getSignalRService).toHaveBeenCalledTimes(1);
        });

        it('brings a guest up once for concurrent callers', async () => {
            const [first, second] = await Promise.all([
                factory.getForServerUrl(GUEST_URL),
                factory.getForServerUrl(GUEST_URL),
            ]);

            expect(second).toBe(first);
            expect(getSignalRService).toHaveBeenCalledTimes(1);
        });

        it('keeps separate guests per server', async () => {
            const other = createMockCallService();
            await factory.getForServerUrl(GUEST_URL);
            vi.mocked(getCallService).mockReturnValueOnce(other as any);

            await expect(factory.getForServerUrl('https://third.ephemon.test')).resolves.toBe(other);
            expect(getSignalRService).toHaveBeenCalledTimes(2);
        });

        describe('when the server will not let us in', () => {
            beforeEach(() => {
                signalR = createMockSignalRService(false);
                vi.mocked(getSignalRService).mockReturnValue(signalR as any);
            });

            it('lets the connection go and says which server refused', async () => {
                await expect(factory.getForServerUrl(GUEST_URL)).rejects.toMatchObject({
                    message: `[call-service-factory] Server ${GUEST_URL} is not reachable.`,
                    serverUrl: GUEST_URL,
                });
                expect(signalR.stop).toHaveBeenCalledTimes(1);
            });

            it('does not announce itself', async () => {
                await factory.getForServerUrl(GUEST_URL).catch(() => {});
                expect(guest.update).not.toHaveBeenCalled();
            });

            it('leaves no retry loop behind', async () => {
                await factory.getForServerUrl(GUEST_URL).catch(() => {});
                await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL * 3);
                expect(guest.update).not.toHaveBeenCalled();
            });

            it('is not cached, so a later attempt starts over', async () => {
                await factory.getForServerUrl(GUEST_URL).catch(() => {});

                signalR = createMockSignalRService(true);
                vi.mocked(getSignalRService).mockReturnValue(signalR as any);

                await expect(factory.getForServerUrl(GUEST_URL)).resolves.toBe(guest);
                expect(getSignalRService).toHaveBeenCalledTimes(2);
            });
        });
    });
});
