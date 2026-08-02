import {
    createMockBase64,
    createMockCryptography,
    createMockLogger,
    createMockSessionService,
    createMockTimeService,
    createMockUtf8,
} from '../../../__mocks__/test-utils';
import { CallRequest } from '../../../src/models/infrasctructure/call-request';
import { OfferCallData } from '../../../src/models/offer-call-data';
import { ConnectionService } from '../../../src/services/connection-service';
import { ConnectionInternal, ConnectionState } from '../../../src/services/connection/connection';
import { ConnectionSagaState } from '../../../src/services/connection/connection-saga';
import { getOfferCallHandler, OfferCallHandler } from '../../../src/services/handle/offer-call-handler';
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

describe('OfferCallHandler', () => {
    let mockLogger: Logger;
    let mockTimeService: Mocked<TimeService>;
    let mockSessionService: Mocked<SessionService>;
    let mockBase64: Mocked<Base64>;
    let mockUtf8: Mocked<Utf8>;
    let mockCryptography: Mocked<Cryptography>;
    let mockConnectionService: Mocked<ConnectionService>;
    let offerCallHandler: OfferCallHandler;

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

        offerCallHandler = getOfferCallHandler(
            mockLogger,
            mockSessionService,
            mockBase64,
            mockUtf8,
            mockCryptography,
            mockConnectionService,
        );
    });

    describe('handle', () => {
        let request: CallRequest<OfferCallData>;

        beforeEach(() => {
            request = {
                a: 'offer',
                b: {
                    a: 'peerPublicKey',
                    b: 1500,
                    c: 'myPublicKey',
                    d: 'encryptionPublicKey',
                    e: 'encryptedSdpOffer',
                },
                c: 'signature',
            };
        });

        it('should process the offer and continue outgoing saga if connection exists and is in correct state', async () => {
            const mockConnection: Partial<ConnectionInternal> = {
                get outgoingState() {
                    return ConnectionSagaState.AwaitingOffer;
                },
                get state() {
                    return ConnectionState.Connecting;
                },
                get publicKey() {
                    return 'peerPublicKey';
                },
                setOutgoingEncryption: vi.fn(),
                setOutgoingDescription: vi.fn().mockResolvedValue(undefined),
                continueOutgoing: vi.fn(),
            };

            mockConnectionService.getConnection.mockReturnValue(mockConnection as ConnectionInternal);

            const result = await offerCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(mockConnection.setOutgoingEncryption).toHaveBeenCalledWith('encryptionPublicKey');
            expect(mockConnection.setOutgoingDescription).toHaveBeenCalledWith('encryptedSdpOffer');
            expect(mockConnection.continueOutgoing).toHaveBeenCalled();
        });

        it('should handle non-existent connection gracefully', async () => {
            mockConnectionService.getConnection.mockReturnValue(undefined);

            const result = await offerCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `[offer-call-handler] Incoming call 'offer' from peerPublicKey ignored. No one connection is there.`,
            );
        });

        it('should not process offer if connection outgoing saga is in the wrong state', async () => {
            const mockConnection: Partial<ConnectionInternal> = {
                get outgoingState() {
                    return ConnectionSagaState.Connected;
                },
                get state() {
                    return ConnectionState.Open;
                },
                get publicKey() {
                    return 'peerPublicKey';
                },
                setOutgoingEncryption: vi.fn(),
                setOutgoingDescription: vi.fn(),
                continueOutgoing: vi.fn(),
            };

            mockConnectionService.getConnection.mockReturnValue(mockConnection as ConnectionInternal);

            const result = await offerCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(mockConnection.setOutgoingEncryption).not.toHaveBeenCalled();
            expect(mockConnection.setOutgoingDescription).not.toHaveBeenCalled();
            expect(mockConnection.continueOutgoing).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `[offer-call-handler] Incoming call 'offer' from peerPublicKey ignored. Outgoing saga is not in suitable state (AwaitingOffer expected, Connected found).`,
            );
        });
    });
});
