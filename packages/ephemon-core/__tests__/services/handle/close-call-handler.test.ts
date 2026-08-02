import {
    createMockBase64,
    createMockCryptography,
    createMockLogger,
    createMockSessionService,
    createMockTimeService,
    createMockUtf8,
} from '../../../__mocks__/test-utils';
import { CloseCallData } from '../../../src/models/close-call-data';
import { CallRequest } from '../../../src/models/infrasctructure/call-request';
import { ConnectionService } from '../../../src/services/connection-service';
import { ConnectionInternal, ConnectionState } from '../../../src/services/connection/connection';
import { ConnectionSagaState } from '../../../src/services/connection/connection-saga';
import { CloseCallHandler, getCloseCallHandler } from '../../../src/services/handle/close-call-handler';
import { SessionService } from '../../../src/services/session-service';
import { TimeService } from '../../../src/services/time-service';
import { Base64 } from '../../../src/utils/base64';
import { Cryptography } from '../../../src/utils/cryptography';
import { Logger } from '../../../src/utils/logger';
import { Utf8 } from '../../../src/utils/utf8';

vi.mock('../../../src/services/time-service');
vi.mock('../../../src/services/session-service');
vi.mock('../../../src/utils/base64');
vi.mock('../../../src/utils/utf8');
vi.mock('../../../src/utils/cryptography');
vi.mock('../../../src/services/connection-service');

describe('CloseCallHandler', () => {
    let mockLogger: Logger;
    let mockTimeService: Mocked<TimeService>;
    let mockSessionService: Mocked<SessionService>;
    let mockBase64: Mocked<Base64>;
    let mockUtf8: Mocked<Utf8>;
    let mockCryptography: Mocked<Cryptography>;
    let mockConnectionService: Mocked<ConnectionService>;
    let closeCallHandler: CloseCallHandler;

    beforeEach(() => {
        vi.clearAllMocks();

        mockLogger = createMockLogger();
        mockTimeService = createMockTimeService() as unknown as Mocked<TimeService>;
        mockSessionService = createMockSessionService() as unknown as Mocked<SessionService>;
        mockBase64 = createMockBase64() as unknown as Mocked<Base64>;
        mockUtf8 = createMockUtf8() as unknown as Mocked<Utf8>;
        mockCryptography = createMockCryptography() as unknown as Mocked<Cryptography>;
        mockConnectionService = {
            getConnection: vi.fn(),
        } as unknown as Mocked<ConnectionService>;

        closeCallHandler = getCloseCallHandler(
            mockLogger,
            mockSessionService,
            mockBase64,
            mockUtf8,
            mockCryptography,
            mockConnectionService,
        );
    });

    describe('validate', () => {
        it('should not enforce the timestamp freshness check', () => {
            const request: CallRequest<CloseCallData> = {
                a: 'close',
                b: {
                    a: 'peerPublicKey',
                    b: 1500,
                    c: mockSessionService.signingPublicKeyBase64,
                },
                c: 'signature',
            };

            const result = closeCallHandler.validate(request, mockTimeService as unknown as TimeService);

            expect(result).toBe(true);
            expect(mockLogger.debug).not.toHaveBeenCalledWith(expect.stringContaining('Request timestamp'));
        });
    });

    describe('handle', () => {
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
        });

        it('should close connection by peer if it exists and is in valid state', async () => {
            const mockConnection: Partial<ConnectionInternal> = {
                get openedAt() {
                    return 1000;
                },
                get publicKey() {
                    return 'peerPublicKey';
                },
                get state() {
                    return ConnectionState.Open;
                },
                get incomingState() {
                    return ConnectionSagaState.Connected;
                },
                get outgoingState() {
                    return ConnectionSagaState.Connected;
                },
                close: vi.fn(),
                closeByPeer: vi.fn(),
            };

            mockConnectionService.getConnection.mockReturnValue(mockConnection as ConnectionInternal);

            const result = await closeCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(mockConnection.closeByPeer).toHaveBeenCalled();
            expect(mockConnection.close).not.toHaveBeenCalled();
        });

        it('should close connection by peer even if it is already closed', async () => {
            const mockConnection: Partial<ConnectionInternal> = {
                get openedAt() {
                    return 1000;
                },
                get publicKey() {
                    return 'peerPublicKey';
                },
                get state() {
                    return ConnectionState.Closed;
                },
                get incomingState() {
                    return ConnectionSagaState.Closed;
                },
                get outgoingState() {
                    return ConnectionSagaState.Closed;
                },
                close: vi.fn(),
                closeByPeer: vi.fn(),
            };

            mockConnectionService.getConnection.mockReturnValue(mockConnection as ConnectionInternal);

            const result = await closeCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(mockConnection.closeByPeer).toHaveBeenCalled();
            expect(mockConnection.close).not.toHaveBeenCalled();
        });

        it('should not close connection if timestamp is too late', async () => {
            const mockConnection: Partial<ConnectionInternal> = {
                get openedAt() {
                    return 2000;
                },
                get publicKey() {
                    return 'peerPublicKey';
                },
                get state() {
                    return ConnectionState.Open;
                },
                get incomingState() {
                    return ConnectionSagaState.Connected;
                },
                get outgoingState() {
                    return ConnectionSagaState.Connected;
                },
                close: vi.fn(),
                closeByPeer: vi.fn(),
            };

            mockConnectionService.getConnection.mockReturnValue(mockConnection as ConnectionInternal);

            const result = await closeCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(mockConnection.closeByPeer).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `[close-call-handler] Incoming call 'close' from peerPublicKey ignored. Timestamp is too late.`,
            );
        });

        it('should handle non-existent connection gracefully', async () => {
            mockConnectionService.getConnection.mockReturnValue(undefined);

            const result = await closeCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `[close-call-handler] Incoming call 'close' from peerPublicKey ignored. No one connection is there.`,
            );
        });
    });
});
