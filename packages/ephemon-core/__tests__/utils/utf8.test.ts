import { createMockUtf8 } from '../../__mocks__/test-utils';
import { getUtf8 } from '../../src/utils/utf8';
import { TextEncoder } from 'node:util';

vi.mock('../../src/utils/nacl-util-wrapper', () => ({
    encodeUTF8: vi.fn().mockImplementation(() => 'encoded-utf8'),
    decodeUTF8: vi.fn().mockImplementation(() => new Uint8Array([1, 2, 3, 4])),
}));

describe('UTF8 utility', () => {
    let utf8: ReturnType<typeof getUtf8>;

    beforeEach(() => {
        vi.clearAllMocks();
        utf8 = createMockUtf8();
    });

    describe('encode', () => {
        it('should call the encode mock with the input', () => {
            const input = new Uint8Array([1, 2, 3, 4]);

            const result = utf8.encode(input);

            expect(utf8.encode).toHaveBeenCalledWith(input);
            expect(result).toBeUndefined();
        });
    });

    describe('decode', () => {
        it('should call the decode mock with the input', () => {
            const input = 'test-utf8-string';

            const result = utf8.decode(input);

            expect(utf8.decode).toHaveBeenCalledWith(input);
            expect(result).toEqual(new Uint8Array([7, 8, 9]));
        });
    });

    describe('integration', () => {
        beforeEach(async () => {
            vi.resetModules();
            vi.doUnmock('../../src/utils/nacl-util-wrapper');

            const { getUtf8: getRealUtf8 } = await import('../../src/utils/utf8');
            utf8 = getRealUtf8();
        });

        it('should correctly encode and decode data', () => {
            const testString = 'Hello, world!';
            const testData = new TextEncoder().encode(testString);

            const encoded = utf8.encode(testData);
            const decoded = utf8.decode(testString);

            expect(encoded).toBe(testString);

            const decodedArray = Array.from(decoded);
            const testDataArray = Array.from(testData);
            expect(decodedArray).toEqual(testDataArray);
        });
    });
});
