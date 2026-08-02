import { getBase64 } from './base64';
import { getUtf8 } from './utf8';

/** This is what a contact code carries and what has to be exchanged out of band (a QR code, a pasted string) before the first connection can be established. */
export interface Contact {
    /** Base64-encoded public signing key of the peer. */
    publicKey: string;

    serverUrl?: string;
}

const base64 = getBase64();
const utf8 = getUtf8();

const PUBLIC_KEY_LENGTH = 32;
const ADDRESS_KIND_IP = 0;
const ADDRESS_KIND_DOMAIN = 1;
const DEFAULT_IP_PORT = 80;
const HTTP_SCHEME = 'http://';
const HTTPS_SCHEME = 'https://';

/** Parses a dotted-quad IPv4 literal into its four bytes. */
function parseIpv4(value: string): Uint8Array | undefined {
    const parts = value.split('.');
    if (parts.length !== 4) {
        return undefined;
    }
    const bytes = new Uint8Array(4);
    for (let index = 0; index < 4; ++index) {
        if (!/^\d{1,3}$/.test(parts[index])) {
            return undefined;
        }
        const octet = +parts[index];
        if (octet > 255) {
            return undefined;
        }
        bytes[index] = octet;
    }
    return bytes;
}

/** Serializes a server URL into the address section of a contact code: a kind marker followed by either the four IPv4 bytes with an optional port, or the UTF-8 bytes of the domain. */
function encodeAddress(serverUrl: string): Uint8Array {
    const address = serverUrl.trim().replace(/\/+$/, '');
    if (address.startsWith(HTTPS_SCHEME)) {
        const domain = address.slice(HTTPS_SCHEME.length);
        if (!domain || domain.includes('/')) {
            throw new Error(`[contact] Unsupported server URL '${serverUrl}'. Expected '${HTTPS_SCHEME}<domain>'.`);
        }
        const domainBytes = utf8.decode(domain);
        const bytes = new Uint8Array(1 + domainBytes.length);
        bytes[0] = ADDRESS_KIND_DOMAIN;
        bytes.set(domainBytes, 1);
        return bytes;
    }
    if (address.startsWith(HTTP_SCHEME)) {
        const authority = address.slice(HTTP_SCHEME.length);
        const separator = authority.lastIndexOf(':');
        const host = separator < 0 ? authority : authority.slice(0, separator);
        const port = separator < 0 ? DEFAULT_IP_PORT : +authority.slice(separator + 1);
        const ip = parseIpv4(host);
        if (!ip || !Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error(
                `[contact] Unsupported server URL '${serverUrl}'. Expected '${HTTP_SCHEME}<ipv4>[:<port>]'.`,
            );
        }
        const bytes = new Uint8Array(port === DEFAULT_IP_PORT ? 5 : 7);
        bytes[0] = ADDRESS_KIND_IP;
        bytes.set(ip, 1);
        if (port !== DEFAULT_IP_PORT) {
            bytes[5] = (port >> 8) & 0xff;
            bytes[6] = port & 0xff;
        }
        return bytes;
    }
    throw new Error(
        `[contact] Unsupported server URL '${serverUrl}'. Expected '${HTTP_SCHEME}<ipv4>[:<port>]' or '${HTTPS_SCHEME}<domain>'.`,
    );
}

function decodeAddress(bytes: Uint8Array): string {
    switch (bytes[0]) {
        case ADDRESS_KIND_DOMAIN: {
            const domain = utf8.encode(bytes.slice(1));
            if (!domain) {
                throw new Error('[contact] Contact code carries an empty domain.');
            }
            return `${HTTPS_SCHEME}${domain}`;
        }
        case ADDRESS_KIND_IP: {
            if (bytes.length !== 5 && bytes.length !== 7) {
                throw new Error(
                    `[contact] Contact code carries a malformed IPv4 address of ${bytes.length - 1} bytes.`,
                );
            }
            const host = `${bytes[1]}.${bytes[2]}.${bytes[3]}.${bytes[4]}`;
            const port = bytes.length === 7 ? (bytes[5] << 8) | bytes[6] : DEFAULT_IP_PORT;
            return port === DEFAULT_IP_PORT ? `${HTTP_SCHEME}${host}` : `${HTTP_SCHEME}${host}:${port}`;
        }
        default:
            throw new Error(`[contact] Contact code carries an unknown address kind '${bytes[0]}'.`);
    }
}

/** Builds the contact code to share with others: the public key followed by the address of the server that relays signalling for it, all Base64-encoded. ICE servers are deliberately not part of a contact — they are a local matter of whoever establishes the connection. */
export function encodeContact(publicKey: string, serverUrl?: string): string {
    const publicKeyBytes = base64.decode(publicKey.trim());
    if (publicKeyBytes.length !== PUBLIC_KEY_LENGTH) {
        throw new Error(
            `[contact] Expected a ${PUBLIC_KEY_LENGTH}-byte public key, got ${publicKeyBytes.length} bytes.`,
        );
    }
    if (!serverUrl || !serverUrl.trim()) {
        return base64.encode(publicKeyBytes);
    }
    const addressBytes = encodeAddress(serverUrl);
    const bytes = new Uint8Array(publicKeyBytes.length + addressBytes.length);
    bytes.set(publicKeyBytes);
    bytes.set(addressBytes, publicKeyBytes.length);
    return base64.encode(bytes);
}

/** A code carrying nothing but a 32-byte public key yields a contact without a server URL. */
export function decodeContact(code: string): Contact {
    const bytes = base64.decode(code.trim());
    if (bytes.length < PUBLIC_KEY_LENGTH) {
        throw new Error(
            `[contact] Expected at least ${PUBLIC_KEY_LENGTH} bytes of contact data, got ${bytes.length} bytes.`,
        );
    }
    const publicKey = base64.encode(bytes.slice(0, PUBLIC_KEY_LENGTH));
    if (bytes.length === PUBLIC_KEY_LENGTH) {
        return { publicKey };
    }
    return { publicKey, serverUrl: decodeAddress(bytes.slice(PUBLIC_KEY_LENGTH)) };
}
