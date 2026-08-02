import {
    createMockBase64,
    createMockCallService,
    createMockCallServiceFactory,
    createMockConnection,
    createMockCryptography,
    createMockLogger,
    createMockSessionService,
    createMockTimeService,
    createMockUtf8,
    createMockWebRTC,
} from '../../__mocks__/test-utils';
import { CallService } from '../../src/services/call-service';
import { getConnectionService } from '../../src/services/connection-service';
import { ConnectionState } from '../../src/services/connection/connection';
import { SessionService } from '../../src/services/session-service';
import { TimeService } from '../../src/services/time-service';
import { Base64 } from '../../src/utils/base64';
import { Cryptography } from '../../src/utils/cryptography';
import { Logger } from '../../src/utils/logger';
import { Utf8 } from '../../src/utils/utf8';

const mockConnections: Record<string, any> = {};

vi.mock('../../src/services/connection/connection', () => {
    return {
        ConnectionState: {
            New: 'new',
            Connecting: 'connecting',
            Open: 'open',
            Closed: 'closed',
        },
        getConnection: vi.fn().mockImplementation((publicKey) => mockConnections[publicKey]),
        translateConnection: vi.fn().mockImplementation((conn) => conn),
    };
});

describe('ConnectionService', () => {
    let connectionService: ReturnType<typeof getConnectionService>;
    let mockLogger: Logger;
    let mockTimeService: TimeService;
    let mockCallService: CallService;
    let mockCallServiceFactory: ReturnType<typeof createMockCallServiceFactory>;
    let mockSessionService: SessionService;
    let mockBase64: Base64;
    let mockUtf8: Utf8;
    let mockCryptography: Cryptography;
    let mockOnIncomingConnection: Mock;

    beforeEach(() => {
        for (const key in mockConnections) {
            delete mockConnections[key];
        }

        mockLogger = createMockLogger();
        mockTimeService = createMockTimeService();
        mockCallService = createMockCallService();
        mockCallServiceFactory = createMockCallServiceFactory(mockCallService);
        mockSessionService = createMockSessionService();
        mockBase64 = createMockBase64();
        mockUtf8 = createMockUtf8();
        mockCryptography = createMockCryptography();
        mockOnIncomingConnection = vi.fn();

        connectionService = getConnectionService(
            mockLogger,
            mockTimeService,
            mockCallServiceFactory,
            mockSessionService,
            mockBase64,
            mockUtf8,
            mockCryptography,
        );
    });

    describe('initialize', () => {
        it('should log debug message when initialized', () => {
            const config = {
                webRTC: createMockWebRTC(),
            };

            connectionService.initialize(config);

            expect(mockLogger.debug).toHaveBeenCalledWith('[connection-service] Initialized.');
        });

        it('should store the onIncomingConnection callback', async () => {
            const config = {
                webRTC: createMockWebRTC(),
                onIncomingConnection: mockOnIncomingConnection,
            };

            connectionService.initialize(config);
            const conn = createMockConnection({ publicKey: 'test-key', state: ConnectionState.New });
            mockConnections['test-key'] = conn;
            connectionService.createIncoming('test-key');

            await new Promise(process.nextTick);
            expect(mockOnIncomingConnection).toHaveBeenCalled();
        });

        it('should handle errors in onIncomingConnection callback', async () => {
            const errorMessage = 'Test callback error';
            const callbackWithError = vi.fn().mockImplementation(() => {
                throw new Error(errorMessage);
            });

            const config = {
                webRTC: createMockWebRTC(),
                onIncomingConnection: callbackWithError,
            };

            connectionService.initialize(config);
            connectionService.createIncoming('test-key');

            await new Promise(process.nextTick);
            expect(callbackWithError).toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(
                '[connection-service] On incoming connection callback error.',
                expect.any(Error),
            );
        });
    });

    describe('connections', () => {
        it('should return array of connections', () => {
            connectionService.initialize({ webRTC: createMockWebRTC() });
            const conn1 = createMockConnection({ publicKey: 'test-key1', state: ConnectionState.New });
            const conn2 = createMockConnection({ publicKey: 'test-key2', state: ConnectionState.New });
            mockConnections['test-key1'] = conn1;
            mockConnections['test-key2'] = conn2;
            connectionService.createOutgoing('test-key1');
            connectionService.createOutgoing('test-key2');

            const result = connectionService.connections;

            expect(result.length).toBe(2);
            expect(result[0]).toBe(conn1);
            expect(result[1]).toBe(conn2);
        });
    });

    describe('getConnection', () => {
        it('should return connection by public key', () => {
            connectionService.initialize({ webRTC: createMockWebRTC() });
            const conn = createMockConnection({ publicKey: 'test-key', state: ConnectionState.New });
            mockConnections['test-key'] = conn;
            connectionService.createOutgoing('test-key');

            const result = connectionService.getConnection('test-key');

            expect(result).toBe(conn);
        });

        it('should return undefined for unknown public key', () => {
            connectionService.initialize({ webRTC: createMockWebRTC() });

            const result = connectionService.getConnection('non-existent-key');

            expect(result).toBeUndefined();
        });
    });

    describe('createIncoming', () => {
        it('should create a new connection', () => {
            connectionService.initialize({ webRTC: createMockWebRTC() });
            const conn = createMockConnection({ publicKey: 'test-key', state: ConnectionState.New });
            mockConnections['test-key'] = conn;

            const result = connectionService.createIncoming('test-key');

            expect(result).toBe(conn);
        });
    });

    describe('createOutgoing', () => {
        it('should create a new connection', () => {
            connectionService.initialize({ webRTC: createMockWebRTC() });
            const conn = createMockConnection({ publicKey: 'test-key', state: ConnectionState.New });
            mockConnections['test-key'] = conn;

            const result = connectionService.createOutgoing('test-key');

            expect(result).toBe(conn);
        });
    });

    describe('deleteConnection', () => {
        it('should close and delete the connection', () => {
            connectionService.initialize({ webRTC: createMockWebRTC() });
            const conn = createMockConnection({ publicKey: 'test-key', state: ConnectionState.Open });
            mockConnections['test-key'] = conn;
            connectionService.createOutgoing('test-key');

            connectionService.deleteConnection('test-key');

            expect(conn.close).toHaveBeenCalled();
            expect(connectionService.getConnection('test-key')).toBeUndefined();
        });

        it('should not try to close connection if already closed', () => {
            connectionService.initialize({ webRTC: createMockWebRTC() });
            const conn = createMockConnection({ publicKey: 'test-key', state: ConnectionState.Closed });
            mockConnections['test-key'] = conn;
            connectionService.createOutgoing('test-key');

            connectionService.deleteConnection('test-key');

            expect(conn.close).not.toHaveBeenCalled();
            expect(connectionService.getConnection('test-key')).toBeUndefined();
        });
    });
});
