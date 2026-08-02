import {
    createMockBase64,
    createMockCryptography,
    createMockLogger,
    createMockSessionService,
    createMockTimeService,
    createMockUtf8,
} from '../../../__mocks__/test-utils';
import { DialCallData } from '../../../src/models/dial-call-data';
import { CallRequest } from '../../../src/models/infrasctructure/call-request';
import { ConnectionService } from '../../../src/services/connection-service';
import { ConnectionSagaState } from '../../../src/services/connection/connection-saga';
import {
    DialCallHandler,
    DialCallHandlerConfig,
    getDialCallHandler,
} from '../../../src/services/handle/dial-call-handler';
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

describe('DialCallHandler', () => {
    let mockLogger: Logger;
    let mockTimeService: Mocked<TimeService>;
    let mockSessionService: Mocked<SessionService>;
    let mockBase64: Mocked<Base64>;
    let mockUtf8: Mocked<Utf8>;
    let mockCryptography: Mocked<Cryptography>;
    let mockConnectionService: Mocked<ConnectionService>;
    let dialCallHandler: DialCallHandler;
    let mockConfig: DialCallHandlerConfig;
    let mockFocusOnDial: Mock;
    let mockRequestDial: Mock;

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
            createIncoming: vi.fn(),
            createOutgoing: vi.fn(),
            deleteConnection: vi.fn(),
            initialize: vi.fn(),
        } as unknown as Mocked<ConnectionService>;

        dialCallHandler = getDialCallHandler(
            mockLogger,
            mockSessionService,
            mockBase64,
            mockUtf8,
            mockCryptography,
            mockConnectionService,
        );

        mockFocusOnDial = vi.fn().mockImplementation(async () => true);
        mockRequestDial = vi.fn().mockImplementation(async () => true);

        mockConfig = {
            focusOnDial: mockFocusOnDial,
            requestDial: mockRequestDial,
        };

        dialCallHandler.initialize(mockConfig);
    });

    describe('initialize', () => {
        it('should initialize the handler and log debug message', () => {
            const handler = getDialCallHandler(
                mockLogger,
                mockSessionService,
                mockBase64,
                mockUtf8,
                mockCryptography,
                mockConnectionService,
            );

            handler.initialize(mockConfig);

            expect(mockLogger.debug).toHaveBeenCalledWith('[dial-call-handler] Initialized.');
        });
    });

    describe('validate', () => {
        it('should not enforce the timestamp freshness check', () => {
            const request: CallRequest<DialCallData> = {
                a: 'dial',
                b: {
                    a: 'peerPublicKey',
                    b: 1500,
                    c: mockSessionService.signingPublicKeyBase64,
                    d: 'encryptionKey',
                },
                c: 'signature',
            };

            const result = dialCallHandler.validate(request, mockTimeService as unknown as TimeService);

            expect(result).toBe(true);
            expect(mockLogger.debug).not.toHaveBeenCalledWith(expect.stringContaining('Request timestamp'));
        });
    });

    describe('handle', () => {
        let request: CallRequest<DialCallData>;

        beforeEach(() => {
            request = {
                a: 'dial',
                b: {
                    a: 'peerPublicKey',
                    b: 1500,
                    c: 'myPublicKey',
                    d: 'encryptionKey',
                },
                c: 'signature',
            };
        });

        it('should continue existing connection when in AwaitingDial state', async () => {
            const connectionMock = {
                setIncomingEncryption: vi.fn(),
                openIncoming: vi.fn().mockResolvedValue(undefined),
                continueIncoming: vi.fn(),
                get incomingState() {
                    return ConnectionSagaState.AwaitingDial;
                },
            };
            mockConnectionService.getConnection = vi.fn().mockReturnValue(connectionMock);

            const result = await dialCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(connectionMock.setIncomingEncryption).toHaveBeenCalledWith('encryptionKey');
            expect(connectionMock.continueIncoming).toHaveBeenCalled();
            expect(connectionMock.openIncoming).not.toHaveBeenCalled();
        });

        it('should reopen connection when not in suitable state', async () => {
            const connectionMock = {
                setIncomingEncryption: vi.fn(),
                openIncoming: vi.fn().mockResolvedValue(undefined),
                continueIncoming: vi.fn(),
            };
            mockConnectionService.getConnection = vi.fn().mockReturnValue(connectionMock);

            const result = await dialCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(connectionMock.setIncomingEncryption).toHaveBeenCalledWith('encryptionKey');
            expect(connectionMock.continueIncoming).not.toHaveBeenCalled();
            expect(connectionMock.openIncoming).toHaveBeenCalled();
            expect(mockFocusOnDial).toHaveBeenCalled();
        });

        it('should create new connection when none exists', async () => {
            mockConnectionService.getConnection = vi.fn().mockReturnValueOnce(undefined);
            const connectionMock = {
                setIncomingEncryption: vi.fn(),
                openIncoming: vi.fn().mockResolvedValue(undefined),
            };
            mockConnectionService.createIncoming = vi.fn().mockReturnValue(connectionMock);

            const result = await dialCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockConnectionService.getConnection).toHaveBeenCalledWith('peerPublicKey');
            expect(mockConnectionService.createIncoming).toHaveBeenCalledWith('peerPublicKey');
            expect(connectionMock.setIncomingEncryption).toHaveBeenCalledWith('encryptionKey');
            expect(connectionMock.openIncoming).toHaveBeenCalled();
            expect(mockFocusOnDial).toHaveBeenCalled();
            expect(mockRequestDial).toHaveBeenCalled();
        });

        it('should return false if focusOnDial returns false', async () => {
            mockConnectionService.getConnection = vi.fn().mockReturnValueOnce(undefined);
            mockFocusOnDial.mockImplementation(async () => false);

            const result = await dialCallHandler.handle(request);

            expect(result).toBe(false);
            expect(mockFocusOnDial).toHaveBeenCalled();
            expect(mockRequestDial).not.toHaveBeenCalled();
            expect(mockConnectionService.createIncoming).not.toHaveBeenCalled();
        });

        it('should log and return true if request is declined', async () => {
            mockConnectionService.getConnection = vi.fn().mockReturnValueOnce(undefined);
            mockRequestDial.mockImplementation(async () => false);

            const result = await dialCallHandler.handle(request);

            expect(result).toBe(true);
            expect(mockFocusOnDial).toHaveBeenCalled();
            expect(mockRequestDial).toHaveBeenCalled();
            expect(mockConnectionService.createIncoming).not.toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                `[dial-call-handler] Incoming call 'dial' from peerPublicKey declined.`,
            );
        });

        it('should skip reconnect logic when incomingState is AwaitingAnswer', async () => {
            const connectionMock = {
                setIncomingEncryption: vi.fn(),
                openIncoming: vi.fn().mockResolvedValue(undefined),
                continueIncoming: vi.fn(),
                get incomingState() {
                    return ConnectionSagaState.AwaitingAnswer;
                },
            };
            mockConnectionService.getConnection = vi.fn().mockReturnValue(connectionMock as any);
            const result = await dialCallHandler.handle(request);
            expect(result).toBe(true);
            expect(connectionMock.setIncomingEncryption).toHaveBeenCalledWith('encryptionKey');
            expect(connectionMock.continueIncoming).not.toHaveBeenCalled();
            expect(connectionMock.openIncoming).not.toHaveBeenCalled();
            expect(mockLogger.debug).not.toHaveBeenCalledWith(expect.stringContaining('triggered connection re-open'));
        });

        it('should reconnect without focusOnDial configured', async () => {
            dialCallHandler.initialize({ requestDial: mockRequestDial });
            const connectionMock = {
                setIncomingEncryption: vi.fn(),
                openIncoming: vi.fn().mockResolvedValue(undefined),
                continueIncoming: vi.fn(),
            };
            mockConnectionService.getConnection = vi.fn().mockReturnValue(connectionMock as any);
            const result = await dialCallHandler.handle(request);
            expect(result).toBe(true);
            expect(connectionMock.openIncoming).toHaveBeenCalled();
            expect(mockFocusOnDial).not.toHaveBeenCalled();
        });
    });
});
