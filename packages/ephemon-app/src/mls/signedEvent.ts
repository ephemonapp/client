import { Reader, Writer } from './byteCodec';

const SIGNED_LABEL = 'signed MLS application event';

export type SignedApplicationEvent = {
    /** The canonical event encoding, which is exactly what the author signed. */
    bytes: Uint8Array;
    /** Empty for an ephemeral event, which carries no chain position and is re-announced rather than replayed. */
    signature: Uint8Array;
};

export function encodeSignedApplicationEvent(event: SignedApplicationEvent): Uint8Array {
    const writer = new Writer();
    writer.variable(event.bytes);
    writer.variable(event.signature);
    return writer.finish();
}

export function decodeSignedApplicationEvent(frame: Uint8Array): SignedApplicationEvent {
    const reader = new Reader(frame, SIGNED_LABEL);
    const bytes = reader.variable();
    const signature = reader.variable();
    reader.finish();
    return { bytes, signature };
}
