import { getBase64 } from '../../src/utils/base64';
import { decodeContact, encodeContact } from '../../src/utils/contact';

const base64 = getBase64();
const PUBLIC_KEY = 'k8FjZ0rQvN2pXwTy7bLm9cAeR4sD1gHuJ6iOoP3aQwE=';

function code(...sections: Array<Uint8Array | number[]>): string {
    const bytes = sections.flatMap((section) => [...section]);
    return base64.encode(Uint8Array.from(bytes));
}

const PUBLIC_KEY_BYTES = base64.decode(PUBLIC_KEY);

describe('contact', () => {
    describe('encodeContact', () => {
        it('carries the public key alone when no server is given', () => {
            expect(encodeContact(PUBLIC_KEY)).toBe(PUBLIC_KEY);
            expect(encodeContact(PUBLIC_KEY, '')).toBe(PUBLIC_KEY);
            expect(encodeContact(PUBLIC_KEY, '   ')).toBe(PUBLIC_KEY);
        });

        it('ignores whitespace around the public key', () => {
            expect(encodeContact(`  ${PUBLIC_KEY}  `)).toBe(PUBLIC_KEY);
        });

        it('rejects a public key of the wrong length', () => {
            expect(() => encodeContact(base64.encode(new Uint8Array(31)))).toThrow(
                /Expected a 32-byte public key, got 31 bytes/,
            );
        });

        it.each([
            ['https://ephemon.example.com', 'https://ephemon.example.com'],
            ['https://ephemon.example.com/', 'https://ephemon.example.com'],
            ['https://ephemon.example.com///', 'https://ephemon.example.com'],
            ['  https://ephemon.example.com  ', 'https://ephemon.example.com'],
            ['https://ephemon.example.com:8443', 'https://ephemon.example.com:8443'],
            ['http://1.2.3.4', 'http://1.2.3.4'],
            ['http://1.2.3.4:80', 'http://1.2.3.4'],
            ['http://127.0.0.1:5027', 'http://127.0.0.1:5027'],
            ['http://255.255.255.255:65535', 'http://255.255.255.255:65535'],
            ['http://0.0.0.0:1', 'http://0.0.0.0:1'],
        ])('round-trips %s', (serverUrl, expected) => {
            const contact = decodeContact(encodeContact(PUBLIC_KEY, serverUrl));
            expect(contact).toEqual({ publicKey: PUBLIC_KEY, serverUrl: expected });
        });

        it('drops the default port from the wire and from the decoded URL', () => {
            expect(base64.decode(encodeContact(PUBLIC_KEY, 'http://1.2.3.4:80'))).toHaveLength(37);
            expect(base64.decode(encodeContact(PUBLIC_KEY, 'http://1.2.3.4:8080'))).toHaveLength(39);
        });

        it.each([
            'http://localhost:8081',
            'http://example.com',
            'http://1.2.3',
            'http://1.2.3.4.5',
            'http://1.2.3.256',
            'http://1.2.3.abc',
            'http://1.2.3.4:0',
            'http://1.2.3.4:65536',
            'http://1.2.3.4:port',
            'http://1.2.3.4/path',
            'https://',
            'ws://1.2.3.4',
            'ephemon.example.com',
        ])('rejects the unsupported server URL %s', (serverUrl) => {
            expect(() => encodeContact(PUBLIC_KEY, serverUrl)).toThrow(/Unsupported server URL/);
        });

        it('rejects a domain that carries a path', () => {
            expect(() => encodeContact(PUBLIC_KEY, 'https://ephemon.example.com/signal')).toThrow(
                /Unsupported server URL/,
            );
        });
    });

    describe('decodeContact', () => {
        it('reads a code that carries the public key alone', () => {
            expect(decodeContact(PUBLIC_KEY)).toEqual({ publicKey: PUBLIC_KEY });
        });

        it('ignores whitespace around the code', () => {
            expect(decodeContact(`\n ${PUBLIC_KEY} \t`)).toEqual({ publicKey: PUBLIC_KEY });
        });

        it('rejects a code too short to hold a public key', () => {
            expect(() => decodeContact(base64.encode(new Uint8Array(31)))).toThrow(
                /Expected at least 32 bytes of contact data, got 31 bytes/,
            );
        });

        it('rejects a code that is not valid Base64', () => {
            expect(() => decodeContact('not base64 at all!')).toThrow();
        });

        it('rejects an unknown address kind', () => {
            expect(() => decodeContact(code(PUBLIC_KEY_BYTES, [7, 1, 2, 3, 4]))).toThrow(/unknown address kind '7'/);
        });

        it.each([
            [[0], 0],
            [[0, 1, 2, 3], 3],
            [[0, 1, 2, 3, 4, 5], 5],
            [[0, 1, 2, 3, 4, 5, 6, 7], 7],
        ])('rejects a malformed IPv4 section %j', (section, expectedLength) => {
            expect(() => decodeContact(code(PUBLIC_KEY_BYTES, section))).toThrow(
                new RegExp(`malformed IPv4 address of ${expectedLength} bytes`),
            );
        });

        it('rejects an empty domain', () => {
            expect(() => decodeContact(code(PUBLIC_KEY_BYTES, [1]))).toThrow(/carries an empty domain/);
        });
    });
});
