import { createMockBase64 } from '../../__mocks__/test-utils';
import { getBase64 } from '../../src/utils/base64';

vi.mock('../../src/utils/nacl-util-wrapper', () => ({
    encodeBase64: vi.fn().mockImplementation(() => 'encoded-base64'),
    decodeBase64: vi.fn().mockImplementation(() => new Uint8Array([1, 2, 3, 4])),
}));

describe('Base64 utility', () => {
    let base64: ReturnType<typeof getBase64>;

    beforeEach(() => {
        vi.clearAllMocks();
        base64 = createMockBase64();
    });

    describe('encode', () => {
        it('should call the encode mock with the input', () => {
            const input = new Uint8Array([1, 2, 3, 4]);

            const result = base64.encode(input);

            expect(base64.encode).toHaveBeenCalledWith(input);
            expect(result).toBe('encoded-data');
        });
    });

    describe('decode', () => {
        it('should call the decode mock with the input', () => {
            const input = 'test-base64-string';

            const result = base64.decode(input);

            expect(base64.decode).toHaveBeenCalledWith(input);
            expect(result).toBeUndefined();
        });
    });

    describe('integration', () => {
        beforeEach(async () => {
            vi.resetModules();
            vi.doUnmock('../../src/utils/nacl-util-wrapper');

            const { getBase64: getRealBase64 } = await import('../../src/utils/base64');
            base64 = getRealBase64();
        });

        it('should correctly encode and decode data', () => {
            const testData = new Uint8Array([72, 101, 108, 108, 111]);

            const encoded = base64.encode(testData);
            const decoded = base64.decode(encoded);

            expect(encoded).toBe('SGVsbG8=');
            expect(decoded).toEqual(testData);
        });
    });
});
