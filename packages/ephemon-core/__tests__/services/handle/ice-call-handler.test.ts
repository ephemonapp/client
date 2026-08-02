import {
    createMockBase64,
    createMockCryptography,
    createMockLogger,
    createMockSessionService,
    createMockTimeService,
    createMockUtf8,
} from '../../../__mocks__/test-utils';
import { IceCallData } from '../../../src/models/ice-call-data';
import { IceSource } from '../../../src/models/ice-source';
import { CallRequest } from '../../../src/models/infrasctructure/call-request';
import { ConnectionService } from '../../../src/services/connection-service';
import { ConnectionInternal, ConnectionState } from '../../../src/services/connection/connection';
import { getIceCallHandler, IceCallHandler } from '../../../src/services/handle/ice-call-handler';
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

describe('IceCallHandler', () => {
    let mockLogger: Logger;
    let mockTimeService: Mocked<TimeService>;
    let mockSessionService: Mocked<SessionService>;
    let mockBase64: Mocked<Base64>;
    let mockUtf8: Mocked<Utf8>;
    let mockCryptography: Mocked<Cryptography>;
    let mockConnectionService: Mocked<ConnectionService>;
    let iceCallHandler: IceCallHandler;

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

        iceCallHandler = getIceCallHandler(
            mockLogger,
            mockSessionService,
            mockBase64,
            mockUtf8,
            mockCryptography,
            mockConnectionService,
        );
    });

    describe('handle', () => {
        let request: CallRequest<IceCallData>;

        beforeEach(() => {
            request = {
                a: 'ice',
                b: {
                    a: 'peerPublicKey',
                    b: 1500,
                    c: 'myPublicKey',
                    d: 'encryptionPublicKey',
                    e: 'encryptedIceCandidate',
                    f: IceSource.Incoming,
                },
                c: 'signature',
            };
        });

        it('should handle non-existent connection gracefully', async () => {
            mockConnectionService.getConnection.mockReturnValue(undefined);

            const result = await iceCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `[ice-call-handler] Incoming call 'ice' from peerPublicKey ignored. No one connection is there.`,
            );
        });

        it('should process incoming ice candidate correctly', async () => {
            const mockConnection: Partial<ConnectionInternal> = {
                get state() {
                    return ConnectionState.Connecting;
                },
                get publicKey() {
                    return 'peerPublicKey';
                },
                setOutgoingEncryption: vi.fn(),
                addOutgoingIce: vi.fn().mockResolvedValue(undefined),
                setIncomingEncryption: vi.fn(),
                addIncomingIce: vi.fn().mockResolvedValue(undefined),
            };

            mockConnectionService.getConnection.mockReturnValue(mockConnection as ConnectionInternal);

            request.b.f = IceSource.Incoming;

            const result = await iceCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(mockConnection.setOutgoingEncryption).toHaveBeenCalledWith('encryptionPublicKey');
            expect(mockConnection.addOutgoingIce).toHaveBeenCalledWith('encryptedIceCandidate');
            expect(mockConnection.setIncomingEncryption).not.toHaveBeenCalled();
            expect(mockConnection.addIncomingIce).not.toHaveBeenCalled();
        });

        it('should process outgoing ice candidate correctly', async () => {
            const mockConnection: Partial<ConnectionInternal> = {
                get state() {
                    return ConnectionState.Connecting;
                },
                get publicKey() {
                    return 'peerPublicKey';
                },
                setOutgoingEncryption: vi.fn(),
                addOutgoingIce: vi.fn().mockResolvedValue(undefined),
                setIncomingEncryption: vi.fn(),
                addIncomingIce: vi.fn().mockResolvedValue(undefined),
            };

            mockConnectionService.getConnection.mockReturnValue(mockConnection as ConnectionInternal);

            request.b.f = IceSource.Outgoing;

            const result = await iceCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(mockConnection.setIncomingEncryption).toHaveBeenCalledWith('encryptionPublicKey');
            expect(mockConnection.addIncomingIce).toHaveBeenCalledWith('encryptedIceCandidate');
            expect(mockConnection.setOutgoingEncryption).not.toHaveBeenCalled();
            expect(mockConnection.addOutgoingIce).not.toHaveBeenCalled();
        });

        it('should handle unknown ice source gracefully', async () => {
            const mockConnection: Partial<ConnectionInternal> = {
                get state() {
                    return ConnectionState.Connecting;
                },
                get publicKey() {
                    return 'peerPublicKey';
                },
                setOutgoingEncryption: vi.fn(),
                addOutgoingIce: vi.fn(),
                setIncomingEncryption: vi.fn(),
                addIncomingIce: vi.fn(),
            };

            mockConnectionService.getConnection.mockReturnValue(mockConnection as ConnectionInternal);

            request.b.f = IceSource.Unknown;

            const result = await iceCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(mockConnection.setOutgoingEncryption).not.toHaveBeenCalled();
            expect(mockConnection.addOutgoingIce).not.toHaveBeenCalled();
            expect(mockConnection.setIncomingEncryption).not.toHaveBeenCalled();
            expect(mockConnection.addIncomingIce).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `[ice-call-handler] Unknown ice source from peerPublicKey ignored.`,
            );
        });
    });
});
