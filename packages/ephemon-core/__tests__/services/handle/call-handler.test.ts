import {
    createMockBase64,
    createMockCryptography,
    createMockLogger,
    createMockSessionService,
    createMockUtf8,
} from '../../../__mocks__/test-utils';
import { CloseCallData } from '../../../src/models/close-call-data';
import { CallPayload } from '../../../src/models/infrasctructure/call-payload';
import { CallRequest } from '../../../src/models/infrasctructure/call-request';
import { getCallHandler } from '../../../src/services/handle/call-handler';
import { SessionService } from '../../../src/services/session-service';
import { TimeService } from '../../../src/services/time-service';
import { Base64 } from '../../../src/utils/base64';
import { Cryptography } from '../../../src/utils/cryptography';
import { Logger } from '../../../src/utils/logger';
import { Utf8 } from '../../../src/utils/utf8';

vi.mock('../../../src/utils/new-error', () => ({
    newError: vi.fn().mockImplementation((logger, message) => {
        return new Error(message);
    }),
}));

vi.mock('../../../src/services/time-service');
vi.mock('../../../src/services/session-service');
vi.mock('../../../src/utils/base64');
vi.mock('../../../src/utils/utf8');
vi.mock('../../../src/utils/cryptography');

describe('CallHandler', () => {
    let mockLogger: Logger;
    let mockTimeService: Mocked<TimeService>;
    let mockSessionService: Mocked<SessionService>;
    let mockBase64: Mocked<Base64>;
    let mockUtf8: Mocked<Utf8>;
    let mockCryptography: Mocked<Cryptography>;
    let callHandler: ReturnType<typeof getCallHandler<CloseCallData>>;
    let originalDateNow: () => number;

    beforeEach(() => {
        vi.clearAllMocks();

        originalDateNow = Date.now;
        Date.now = vi.fn(() => 1000);

        mockLogger = createMockLogger();
        let _serverTime = 1000;
        mockTimeService = {
            get serverTime() {
                return _serverTime;
            },
            set serverTime(val: number) {
                _serverTime = val;
            },
        } as unknown as Mocked<TimeService>;
        mockSessionService = createMockSessionService() as unknown as Mocked<SessionService>;
        mockBase64 = createMockBase64() as unknown as Mocked<Base64>;
        mockUtf8 = createMockUtf8() as unknown as Mocked<Utf8>;
        mockCryptography = createMockCryptography() as unknown as Mocked<Cryptography>;

        callHandler = getCallHandler<CloseCallData>(
            mockLogger,
            mockSessionService,
            mockBase64,
            mockUtf8,
            mockCryptography,
        );
    });

    afterEach(() => {
        Date.now = originalDateNow;
    });

    describe('parse', () => {
        it('should parse valid payload', () => {
            const closeData: CloseCallData = {
                a: 'publicKey',
                b: 1500,
                c: 'myPublicKey',
            };

            const payload: CallPayload = {
                a: 'close',
                b: JSON.stringify(closeData),
                c: 'signature',
            };

            const result = callHandler.parse(payload);

            expect(result).toEqual({
                a: 'close',
                b: closeData,
                c: 'signature',
            });
        });

        it('should throw an error when data cannot be parsed', () => {
            const error = new Error('JSON parse error');
            vi.spyOn(JSON, 'parse').mockImplementation(() => {
                throw error;
            });

            const payload: CallPayload = {
                a: 'close',
                b: '{invalid-json',
                c: 'signature',
            };

            expect(() => callHandler.parse(payload)).toThrow();

            vi.spyOn(JSON, 'parse').mockRestore();
        });

        it('should throw an error when parsed data is null', () => {
            vi.spyOn(JSON, 'parse').mockReturnValue(null);

            const payload: CallPayload = {
                a: 'close',
                b: 'null',
                c: 'signature',
            };

            expect(() => callHandler.parse(payload)).toThrow();

            vi.spyOn(JSON, 'parse').mockRestore();
        });
    });

    describe('validate', () => {
        let request: CallRequest<CloseCallData>;

        beforeEach(() => {
            request = {
                a: 'close',
                b: {
                    a: 'peerPublicKey',
                    b: 1500,
                    c: 'myPublicKey',
                },
                c: 'signature',
            };
            mockSessionService = {
                ...mockSessionService,
                signingPublicKeyBase64: 'myPublicKey',
            } as any;
            const validBytes = new Uint8Array([1, 2, 3]);
            mockBase64.decode = vi.fn((input) => {
                if (input === 'signature' || input === 'peerPublicKey') return validBytes;
                return new Uint8Array([9, 9, 9]);
            });
            mockUtf8.decode = vi.fn((input) => {
                if (input === JSON.stringify(request.b)) return validBytes;
                return new Uint8Array([9, 9, 9]);
            });
            mockCryptography.verifySignature = vi.fn((data, signature, publicKey) => true);
            callHandler = getCallHandler<CloseCallData>(
                mockLogger,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
            );
        });

        it('should validate request with valid timestamp, key and signature', () => {
            const result = callHandler.validate(request, mockTimeService as unknown as TimeService);

            expect(result).toBe(true);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                '[close-call-handler] Request timestamp is valid (delta 500ms).',
            );
            expect(mockLogger.debug).toHaveBeenCalledWith('[close-call-handler] Message is intended for this user.');
            expect(mockLogger.debug).toHaveBeenCalledWith('[close-call-handler] Signature is valid.');
        });

        it('should fail validation if timestamp is stale', () => {
            request.b.b = 100000;

            const result = callHandler.validate(request, mockTimeService as unknown as TimeService);

            expect(result).toBe(false);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                '[close-call-handler] Request timestamp is more than 5000ms stale (delta 99000ms).',
            );
        });

        it('should fail validation with a custom timestampMaxStale threshold', () => {
            callHandler = getCallHandler<CloseCallData>(
                mockLogger,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                100,
            );
            request.b.b = 1500;

            const result = callHandler.validate(request, mockTimeService as unknown as TimeService);

            expect(result).toBe(false);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                '[close-call-handler] Request timestamp is more than 100ms stale (delta 500ms).',
            );
        });

        it('should skip timestamp validation when timestampMaxStale is 0', () => {
            callHandler = getCallHandler<CloseCallData>(
                mockLogger,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                0,
            );
            request.b.b = 100000;

            const result = callHandler.validate(request, mockTimeService as unknown as TimeService);

            expect(result).toBe(true);
            expect(mockLogger.debug).not.toHaveBeenCalledWith(expect.stringContaining('Request timestamp'));
            expect(mockLogger.debug).toHaveBeenCalledWith('[close-call-handler] Message is intended for this user.');
            expect(mockLogger.debug).toHaveBeenCalledWith('[close-call-handler] Signature is valid.');
        });

        it('should fail validation if message is not intended for the user', () => {
            request.b.c = 'differentPublicKey';

            const result = callHandler.validate(request, mockTimeService as unknown as TimeService);

            expect(result).toBe(false);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                '[close-call-handler] Message is not intended for this user.',
            );
        });

        it('should fail validation if signature is invalid', () => {
            mockCryptography.verifySignature.mockReturnValue(false);

            const result = callHandler.validate(request, mockTimeService as unknown as TimeService);

            expect(result).toBe(false);
            expect(mockLogger.debug).toHaveBeenCalledWith('[close-call-handler] Signature is not valid.');
        });
    });

    describe('handle', () => {
        it('should throw error by default', async () => {
            const request: CallRequest<CloseCallData> = {
                a: 'close',
                b: {
                    a: 'peerPublicKey',
                    b: 1500,
                    c: 'myPublicKey',
                },
                c: 'signature',
            };

            try {
                await callHandler.handle(request);
                expect('Should have thrown').toBe('But did not throw');
            } catch (error: any) {
                expect(error.message).toBe('[close-call-handler] Base handle method is not implemented.');
            }
        });
    });
});
