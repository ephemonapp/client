import {
    createMockBase64,
    createMockCallService,
    createMockCallServiceFactory,
    createMockCryptography,
    createMockLogger,
    createMockSessionService,
    createMockTimeService,
    createMockUtf8,
} from '../../../__mocks__/test-utils';
import { ConnectionState } from '../../../src';
import { CloseCallData } from '../../../src/models/close-call-data';
import { CallRequest } from '../../../src/models/infrasctructure/call-request';
import { CallService } from '../../../src/services/call-service';
import { getConnectionService } from '../../../src/services/connection-service';
import { WebRTC } from '../../../src/services/connection/web-rtc';
import { getCloseCallHandler } from '../../../src/services/handle/close-call-handler';
import { SessionService } from '../../../src/services/session-service';
import { TimeService } from '../../../src/services/time-service';
import { Base64 } from '../../../src/utils/base64';
import { Cryptography } from '../../../src/utils/cryptography';
import { Utf8 } from '../../../src/utils/utf8';

describe('an incoming close, from the wire to the application', () => {
    it('ends the conversation without telling the peer anything', async () => {
        const logger = createMockLogger();
        const timeService = createMockTimeService() as unknown as TimeService;
        const sessionService = createMockSessionService() as unknown as SessionService;
        const base64 = createMockBase64() as unknown as Base64;
        const utf8 = createMockUtf8() as unknown as Utf8;
        const cryptography = createMockCryptography() as unknown as Cryptography;
        const callService = createMockCallService() as unknown as CallService;
        const callServiceFactory = createMockCallServiceFactory(callService);

        const connectionService = getConnectionService(
            logger,
            timeService,
            callServiceFactory,
            sessionService,
            base64,
            utf8,
            cryptography,
        );
        connectionService.initialize({
            webRTC: { PeerConnection: vi.fn(), DataChannel: vi.fn() } as unknown as WebRTC,
        });

        const peerPublicKey = 'peer-public-key';
        const connection = connectionService.createOutgoing(peerPublicKey);
        let told = 0;
        connection.onClosedByPeer = () => {
            told += 1;
        };

        const handler = getCloseCallHandler(logger, sessionService, base64, utf8, cryptography, connectionService);
        const request: CallRequest<CloseCallData> = {
            a: 'close',
            b: { a: peerPublicKey, b: timeService.serverTime, c: sessionService.signingPublicKeyBase64 },
            c: 'signature',
        };

        expect(handler.validate({ ...request, b: { ...request.b, b: 1 } }, timeService)).toBe(true);

        expect(await handler.handle(request)).toBe(true);

        expect(told).toBe(1);
        expect(callService.close).not.toHaveBeenCalled();
        expect(connection.state).toBe(ConnectionState.Closed);

        connectionService.deleteConnection(peerPublicKey);

        expect(callService.close).not.toHaveBeenCalled();

        expect(await handler.handle(request)).toBe(true);

        expect(told).toBe(1);
        expect(callService.close).not.toHaveBeenCalled();
    });
});
