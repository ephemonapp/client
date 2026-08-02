import {
    createMockBase64,
    createMockCryptography,
    createMockLogger,
    createMockSessionService,
    createMockTimeService,
    createMockUtf8,
} from '../../../__mocks__/test-utils';
import { AnswerCallData } from '../../../src/models/answer-call-data';
import { CallRequest } from '../../../src/models/infrasctructure/call-request';
import { ConnectionService } from '../../../src/services/connection-service';
import { ConnectionInternal, ConnectionState } from '../../../src/services/connection/connection';
import { ConnectionSagaState } from '../../../src/services/connection/connection-saga';
import { AnswerCallHandler, getAnswerCallHandler } from '../../../src/services/handle/answer-call-handler';
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

describe('AnswerCallHandler', () => {
    let mockLogger: Logger;
    let mockTimeService: Mocked<TimeService>;
    let mockSessionService: Mocked<SessionService>;
    let mockBase64: Mocked<Base64>;
    let mockUtf8: Mocked<Utf8>;
    let mockCryptography: Mocked<Cryptography>;
    let mockConnectionService: Mocked<ConnectionService>;
    let answerCallHandler: AnswerCallHandler;

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

        answerCallHandler = getAnswerCallHandler(
            mockLogger,
            mockSessionService,
            mockBase64,
            mockUtf8,
            mockCryptography,
            mockConnectionService,
        );
    });

    describe('handle', () => {
        let request: CallRequest<AnswerCallData>;

        beforeEach(() => {
            request = {
                a: 'answer',
                b: {
                    a: 'peerPublicKey',
                    b: 1500,
                    c: 'myPublicKey',
                    d: 'encryptionPublicKey',
                    e: 'encryptedSdpAnswer',
                },
                c: 'signature',
            };
        });

        it('should process the answer and continue incoming saga if connection exists and is in correct state', async () => {
            const mockConnection: Partial<ConnectionInternal> = {
                get incomingState() {
                    return ConnectionSagaState.AwaitingAnswer;
                },
                get state() {
                    return ConnectionState.Connecting;
                },
                get publicKey() {
                    return 'peerPublicKey';
                },
                setIncomingEncryption: vi.fn(),
                setIncomingDescription: vi.fn().mockResolvedValue(undefined),
                continueIncoming: vi.fn(),
            };

            mockConnectionService.getConnection.mockReturnValue(mockConnection as ConnectionInternal);

            const result = await answerCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(mockConnection.setIncomingEncryption).toHaveBeenCalledWith('encryptionPublicKey');
            expect(mockConnection.setIncomingDescription).toHaveBeenCalledWith('encryptedSdpAnswer');
            expect(mockConnection.continueIncoming).toHaveBeenCalled();
        });

        it('should handle non-existent connection gracefully', async () => {
            mockConnectionService.getConnection.mockReturnValue(undefined);

            const result = await answerCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `[answer-call-handler] Incoming call 'answer' from peerPublicKey ignored. No one connection is there.`,
            );
        });

        it('should not process answer if connection incoming saga is in the wrong state', async () => {
            const mockConnection: Partial<ConnectionInternal> = {
                get incomingState() {
                    return ConnectionSagaState.Connected;
                },
                get state() {
                    return ConnectionState.Open;
                },
                get publicKey() {
                    return 'peerPublicKey';
                },
                setIncomingEncryption: vi.fn(),
                setIncomingDescription: vi.fn(),
                continueIncoming: vi.fn(),
            };

            mockConnectionService.getConnection.mockReturnValue(mockConnection as ConnectionInternal);

            const result = await answerCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(mockConnection.setIncomingEncryption).not.toHaveBeenCalled();
            expect(mockConnection.setIncomingDescription).not.toHaveBeenCalled();
            expect(mockConnection.continueIncoming).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `[answer-call-handler] Incoming call 'answer' from peerPublicKey ignored. Incoming saga is not in suitable state (AwaitingAnswer expected, Connected found).`,
            );
        });
    });
});
