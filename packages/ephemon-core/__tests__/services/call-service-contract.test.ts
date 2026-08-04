import {
    createMockBase64,
    createMockCryptography,
    createMockLogger,
    createMockSessionService,
    createMockTimeService,
    createMockUtf8,
} from '../../__mocks__/test-utils';
import { IceSource } from '../../src/models/ice-source';
import { getCallService } from '../../src/services/call-service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE_PATH = resolve(process.cwd(), '__tests__/fixtures/signaling-contract.v1.jsonl');

describe('signaling wire contract v1', () => {
    it('keeps update/dial/offer/answer/ice/close JSON byte-for-byte stable', async () => {
        const response = { ok: true, timestamp: 123456789 };
        const signalR = {
            initialize: vi.fn(),
            get ready() {
                return true;
            },
            call: vi.fn().mockResolvedValue(response),
        };
        const apiClient = { call: vi.fn().mockResolvedValue(response) };
        const beaconBodies: string[] = [];
        const navigator = { sendBeacon: vi.fn().mockReturnValue(true) };
        const OriginalBlob = globalThis.Blob;
        globalThis.Blob = vi.fn(function (parts: BlobPart[]) {
            beaconBodies.push(String(parts[0]));
            return {};
        }) as unknown as typeof Blob;

        try {
            const service = getCallService(
                createMockLogger(),
                createMockTimeService(),
                createMockSessionService(),
                apiClient as any,
                signalR as any,
                createMockBase64({
                    '1,2,3,4': 'AQIDBA==',
                    '10,11,12': 'test-signature',
                }),
                createMockUtf8(),
                createMockCryptography(),
            );
            service.initialize({
                serverUrl: 'https://test-server.com',
                navigator: navigator as unknown as Navigator,
                allowApiFallback: true,
            });

            const publicKey = 'test-public-key';
            const peerPublicKey = 'test-peer-public-key';
            const encryptionPublicKey = 'test-encryption-public-key';
            const encryptedData = new Uint8Array([1, 2, 3, 4]);
            await service.update(publicKey, {
                endpoint: 'test-endpoint',
                expirationTime: 9999999,
                keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
            });
            await service.dial(publicKey, peerPublicKey, encryptionPublicKey);
            await service.offer(publicKey, peerPublicKey, encryptionPublicKey, encryptedData);
            await service.answer(publicKey, peerPublicKey, encryptionPublicKey, encryptedData);
            await service.ice(publicKey, peerPublicKey, encryptionPublicKey, encryptedData, IceSource.Incoming);
            service.close(publicKey, peerPublicKey);

            const actual = signalR.call.mock.calls.map(([request]) => JSON.stringify(request));
            actual.push(...beaconBodies);
            const expected = readFileSync(FIXTURE_PATH, 'utf8').trimEnd().split('\n');

            expect(actual).toEqual(expected);
            expect(navigator.sendBeacon).toHaveBeenCalledWith(
                'https://test-server.com/api/v1/call',
                expect.any(Object),
            );
        } finally {
            globalThis.Blob = OriginalBlob;
        }
    });
});
