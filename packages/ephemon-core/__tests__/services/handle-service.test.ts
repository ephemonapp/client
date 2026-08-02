import {
    createMockAnswerCallHandler,
    createMockTimeService,
    createMockCloseCallHandler,
    createMockDialCallHandler,
    createMockIceCallHandler,
    createMockLogger,
    createMockOfferCallHandler,
} from '../../__mocks__/test-utils';
import { AnswerCallData } from '../../src/models/answer-call-data';
import { CloseCallData } from '../../src/models/close-call-data';
import { DialCallData } from '../../src/models/dial-call-data';
import { IceCallData } from '../../src/models/ice-call-data';
import { CallPayload } from '../../src/models/infrasctructure/call-payload';
import { CallRequest } from '../../src/models/infrasctructure/call-request';
import { OfferCallData } from '../../src/models/offer-call-data';
import { getHandleService, HandleService, HandleServiceConfig } from '../../src/services/handle-service';
import { AnswerCallHandler } from '../../src/services/handle/answer-call-handler';
import { CloseCallHandler } from '../../src/services/handle/close-call-handler';
import { DialCallHandler } from '../../src/services/handle/dial-call-handler';
import { IceCallHandler } from '../../src/services/handle/ice-call-handler';
import { OfferCallHandler } from '../../src/services/handle/offer-call-handler';
import { TimeService as TimeServiceType } from '../../src/services/time-service';
import { Logger } from '../../src/utils/logger';

vi.mock('../../src/services/handle/dial-call-handler');
vi.mock('../../src/services/handle/offer-call-handler');
vi.mock('../../src/services/handle/answer-call-handler');
vi.mock('../../src/services/handle/ice-call-handler');
vi.mock('../../src/services/handle/close-call-handler');

describe('HandleService', () => {
    let handleService: HandleService;
    let mockLogger: Logger;
    let mockDialHandler: Mocked<DialCallHandler>;
    let mockOfferHandler: Mocked<OfferCallHandler>;
    let mockAnswerHandler: Mocked<AnswerCallHandler>;
    let mockIceHandler: Mocked<IceCallHandler>;
    let mockCloseHandler: Mocked<CloseCallHandler>;
    let mockConfig: HandleServiceConfig;
    let mockTimeService: ReturnType<typeof createMockTimeService>;

    vi.useFakeTimers();

    beforeEach(() => {
        vi.clearAllMocks();

        mockLogger = createMockLogger();
        mockTimeService = createMockTimeService();

        mockDialHandler = createMockDialCallHandler();
        mockOfferHandler = createMockOfferCallHandler();
        mockAnswerHandler = createMockAnswerCallHandler();
        mockIceHandler = createMockIceCallHandler();
        mockCloseHandler = createMockCloseCallHandler();

        mockConfig = {
            focusOnDial: vi.fn(),
            requestDial: vi.fn(),
        };

        handleService = getHandleService(
            mockLogger,
            mockDialHandler,
            mockOfferHandler,
            mockAnswerHandler,
            mockIceHandler,
            mockCloseHandler,
        );
    });

    describe('initialize', () => {
        it('should initialize the dial handler and log debug message', () => {
            handleService.initialize(mockConfig);

            expect(mockDialHandler.initialize).toHaveBeenCalledWith(mockConfig);
            expect(mockLogger.debug).toHaveBeenCalledWith('[handle-service] Initialized.');
        });
    });

    describe('call', () => {
        beforeEach(() => {
            handleService.initialize(mockConfig);
        });

        it('should process dial call payload', async () => {
            const payload: CallPayload = { a: 'dial', b: '{}', c: 'signature' };
            const mockRequest: CallRequest<DialCallData> = {
                a: 'dial',
                b: {
                    a: 'publicKey',
                    b: 12345,
                    c: 'targetKey',
                    d: 'encryptionKey',
                },
                c: 'signature',
            };

            mockDialHandler.parse.mockReturnValue(mockRequest);
            mockDialHandler.validate.mockReturnValue(true);
            mockDialHandler.handle.mockResolvedValue(true);

            await handleService.call(payload, mockTimeService as unknown as TimeServiceType);

            expect(mockDialHandler.parse).toHaveBeenCalledWith(payload);
            expect(mockDialHandler.validate).toHaveBeenCalledWith(mockRequest, mockTimeService);
            expect(mockDialHandler.handle).toHaveBeenCalledWith(mockRequest);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `[handle-service] Processing incoming call 'dial' from ${mockRequest.b.a}...`,
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `[handle-service] Successfully processed call 'dial'`,
                payload,
            );
        });

        it('should process offer call payload', async () => {
            const payload: CallPayload = { a: 'offer', b: '{}', c: 'signature' };
            const mockRequest: CallRequest<OfferCallData> = {
                a: 'offer',
                b: {
                    a: 'publicKey',
                    b: 12345,
                    c: 'targetKey',
                    d: 'encryptionKey',
                    e: 'sdpOffer',
                },
                c: 'signature',
            };

            mockOfferHandler.parse.mockReturnValue(mockRequest);
            mockOfferHandler.validate.mockReturnValue(true);
            mockOfferHandler.handle.mockResolvedValue(true);

            await handleService.call(payload, mockTimeService as unknown as TimeServiceType);

            expect(mockOfferHandler.parse).toHaveBeenCalledWith(payload);
            expect(mockOfferHandler.validate).toHaveBeenCalledWith(mockRequest, mockTimeService);
            expect(mockOfferHandler.handle).toHaveBeenCalledWith(mockRequest);
        });

        it('should process answer call payload', async () => {
            const payload: CallPayload = { a: 'answer', b: '{}', c: 'signature' };
            const mockRequest: CallRequest<AnswerCallData> = {
                a: 'answer',
                b: {
                    a: 'publicKey',
                    b: 12345,
                    c: 'targetKey',
                    d: 'encryptionKey',
                    e: 'sdpAnswer',
                },
                c: 'signature',
            };

            mockAnswerHandler.parse.mockReturnValue(mockRequest);
            mockAnswerHandler.validate.mockReturnValue(true);
            mockAnswerHandler.handle.mockResolvedValue(true);

            await handleService.call(payload, mockTimeService as unknown as TimeServiceType);

            expect(mockAnswerHandler.parse).toHaveBeenCalledWith(payload);
            expect(mockAnswerHandler.validate).toHaveBeenCalledWith(mockRequest, mockTimeService);
            expect(mockAnswerHandler.handle).toHaveBeenCalledWith(mockRequest);
        });

        it('should process ice call payload', async () => {
            const payload: CallPayload = { a: 'ice', b: '{}', c: 'signature' };
            const mockRequest: CallRequest<IceCallData> = {
                a: 'ice',
                b: {
                    a: 'publicKey',
                    b: 12345,
                    c: 'targetKey',
                    d: 'candidate',
                    e: 'mid',
                    f: 1,
                },
                c: 'signature',
            };

            mockIceHandler.parse.mockReturnValue(mockRequest);
            mockIceHandler.validate.mockReturnValue(true);
            mockIceHandler.handle.mockResolvedValue(true);

            await handleService.call(payload, mockTimeService as unknown as TimeServiceType);

            expect(mockIceHandler.parse).toHaveBeenCalledWith(payload);
            expect(mockIceHandler.validate).toHaveBeenCalledWith(mockRequest, mockTimeService);
            expect(mockIceHandler.handle).toHaveBeenCalledWith(mockRequest);
        });

        it('should process close call payload', async () => {
            const payload: CallPayload = { a: 'close', b: '{}', c: 'signature' };
            const mockRequest: CallRequest<CloseCallData> = {
                a: 'close',
                b: {
                    a: 'publicKey',
                    b: 12345,
                    c: 'targetKey',
                },
                c: 'signature',
            };

            mockCloseHandler.parse.mockReturnValue(mockRequest);
            mockCloseHandler.validate.mockReturnValue(true);
            mockCloseHandler.handle.mockResolvedValue(true);

            await handleService.call(payload, mockTimeService as unknown as TimeServiceType);

            expect(mockCloseHandler.parse).toHaveBeenCalledWith(payload);
            expect(mockCloseHandler.validate).toHaveBeenCalledWith(mockRequest, mockTimeService);
            expect(mockCloseHandler.handle).toHaveBeenCalledWith(mockRequest);
        });

        it('should skip processing when validation fails', async () => {
            const payload: CallPayload = { a: 'dial', b: '{}', c: 'signature' };
            const mockRequest: CallRequest<DialCallData> = {
                a: 'dial',
                b: {
                    a: 'publicKey',
                    b: 12345,
                    c: 'targetKey',
                    d: 'encryptionKey',
                },
                c: 'signature',
            };

            mockDialHandler.parse.mockReturnValue(mockRequest);
            mockDialHandler.validate.mockReturnValue(false);

            await handleService.call(payload, mockTimeService as unknown as TimeServiceType);

            expect(mockDialHandler.parse).toHaveBeenCalledWith(payload);
            expect(mockDialHandler.validate).toHaveBeenCalledWith(mockRequest, mockTimeService);
            expect(mockDialHandler.handle).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(`[handle-service] Call 'dial' is not valid, skipped.`);
        });

        it('should queue payload when handler returns false', async () => {
            const payload: CallPayload = { a: 'dial', b: '{}', c: 'signature' };
            const mockRequest: CallRequest<DialCallData> = {
                a: 'dial',
                b: {
                    a: 'publicKey',
                    b: 12345,
                    c: 'targetKey',
                    d: 'encryptionKey',
                },
                c: 'signature',
            };

            mockDialHandler.parse.mockReturnValue(mockRequest);
            mockDialHandler.validate.mockReturnValue(true);
            mockDialHandler.handle.mockResolvedValue(false);

            await handleService.call(payload, mockTimeService as unknown as TimeServiceType);

            expect(mockDialHandler.parse).toHaveBeenCalledWith(payload);
            expect(mockDialHandler.validate).toHaveBeenCalledWith(mockRequest, mockTimeService);
            expect(mockDialHandler.handle).toHaveBeenCalledWith(mockRequest);
            expect(mockLogger.debug).toHaveBeenCalledWith(`[handle-service] Postpone processing call 'dial'.`, payload);
        });

        it('should process queued calls', async () => {
            const payload1: CallPayload = { a: 'dial', b: '{}', c: 'signature1' };
            const payload2: CallPayload = { a: 'dial', b: '{}', c: 'signature2' };
            const mockRequest: CallRequest<DialCallData> = {
                a: 'dial',
                b: {
                    a: 'publicKey',
                    b: 12345,
                    c: 'targetKey',
                    d: 'encryptionKey',
                },
                c: 'signature',
            };

            mockDialHandler.parse.mockReturnValue(mockRequest);
            mockDialHandler.validate.mockReturnValue(true);
            mockDialHandler.handle.mockResolvedValueOnce(false);

            await handleService.call(payload1, mockTimeService as unknown as TimeServiceType);

            mockDialHandler.handle.mockResolvedValueOnce(false);
            await handleService.call(payload2, mockTimeService as unknown as TimeServiceType);

            mockDialHandler.handle.mockResolvedValue(true);

            vi.advanceTimersByTime(500);

            expect(mockDialHandler.handle).toHaveBeenCalledTimes(3);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `[handle-service] Postpone processing call 'dial'.`,
                payload1,
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `[handle-service] Postpone processing call 'dial'.`,
                payload2,
            );
        });

        it('should handle unknown call type', async () => {
            const payload = { a: 'unknown', b: '{}', c: 'signature' } as any as CallPayload;

            await handleService.call(payload, mockTimeService as unknown as TimeServiceType);

            expect(mockDialHandler.parse).not.toHaveBeenCalled();
            expect(mockDialHandler.handle).not.toHaveBeenCalled();
            expect(mockOfferHandler.parse).not.toHaveBeenCalled();
            expect(mockOfferHandler.handle).not.toHaveBeenCalled();
            expect(mockAnswerHandler.parse).not.toHaveBeenCalled();
            expect(mockAnswerHandler.handle).not.toHaveBeenCalled();
            expect(mockIceHandler.parse).not.toHaveBeenCalled();
            expect(mockIceHandler.handle).not.toHaveBeenCalled();
            expect(mockCloseHandler.parse).not.toHaveBeenCalled();
            expect(mockCloseHandler.handle).not.toHaveBeenCalled();
        });
    });
});
