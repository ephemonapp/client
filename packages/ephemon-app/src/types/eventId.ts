import { decodeBase64Url, encodeBase64Url } from '../utils/base64Url';

declare const eventIdBrand: unique symbol;

export type EventId = string & { readonly [eventIdBrand]: 'EventId' };

export const MLS_EVENT_ID_PREFIX = 'm:';
export const SELF_CHAT_RECORD_ID_PREFIX = 's:';
export const DATE_SEPARATOR_ID_PREFIX = 'd:';

export const MLS_EVENT_HASH_BYTES = 32;

const TIMESTAMP = '(0|[1-9][0-9]{0,15})';
const RECORD_KIND = '(message|delivered|seen|reaction)';
const MLS_EVENT_ID_PATTERN = /^m:[A-Za-z0-9_-]{43}$/;
const SELF_CHAT_RECORD_ID_PATTERN = new RegExp(`^s:(you|peer):${RECORD_KIND}:${TIMESTAMP}$`);
const DATE_SEPARATOR_ID_PATTERN = new RegExp(`^d:${TIMESTAMP}$`);

export function toEventId(value: string): EventId {
    if (
        !MLS_EVENT_ID_PATTERN.test(value) &&
        !SELF_CHAT_RECORD_ID_PATTERN.test(value) &&
        !DATE_SEPARATOR_ID_PATTERN.test(value)
    ) {
        throw new RangeError(`EventId must be an MLS, self-chat or separator identifier, received '${value}'`);
    }
    return value as EventId;
}

export function isMlsEventId(value: EventId): boolean {
    return value.startsWith(MLS_EVENT_ID_PREFIX);
}

export function isSelfChatRecordId(value: EventId): boolean {
    return value.startsWith(SELF_CHAT_RECORD_ID_PREFIX);
}

export function isDateSeparatorId(value: EventId): boolean {
    return value.startsWith(DATE_SEPARATOR_ID_PREFIX);
}

export function toMlsEventId(hash: Uint8Array): EventId {
    if (hash.byteLength !== MLS_EVENT_HASH_BYTES) {
        throw new RangeError(`An MLS event hash must be ${MLS_EVENT_HASH_BYTES} bytes, received ${hash.byteLength}`);
    }
    return `${MLS_EVENT_ID_PREFIX}${encodeBase64Url(hash)}` as EventId;
}

export function mlsEventHash(value: EventId): Uint8Array {
    if (!isMlsEventId(value)) throw new RangeError(`'${value}' is not an MLS event identifier`);
    const hash = decodeBase64Url(value.slice(MLS_EVENT_ID_PREFIX.length));
    if (hash.byteLength !== MLS_EVENT_HASH_BYTES) {
        throw new RangeError(`'${value}' does not decode to ${MLS_EVENT_HASH_BYTES} bytes`);
    }
    return hash;
}

function requireTimestamp(timestamp: number): number {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        throw new RangeError('A record timestamp must be a non-negative safe integer');
    }
    return timestamp;
}

export type SelfChatRecordKind = 'message' | 'delivered' | 'seen' | 'reaction';

export function toSelfChatRecordId(sender: 'you' | 'peer', kind: SelfChatRecordKind, timestamp: number): EventId {
    return toEventId(`${SELF_CHAT_RECORD_ID_PREFIX}${sender}:${kind}:${requireTimestamp(timestamp)}`);
}

export function toDateSeparatorId(timestamp: number): EventId {
    return toEventId(`${DATE_SEPARATOR_ID_PREFIX}${requireTimestamp(timestamp)}`);
}

export function timestampOfRecordId(value: EventId): number {
    if (isMlsEventId(value)) throw new RangeError(`'${value}' is content-addressed and carries no timestamp`);
    return Number(value.slice(value.lastIndexOf(':') + 1));
}
