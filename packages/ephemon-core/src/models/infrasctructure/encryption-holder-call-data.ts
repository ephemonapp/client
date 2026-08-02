import { TransmittableCallData } from './transmittable-call-data';

export interface EncryptionHolderCallData extends TransmittableCallData {
    /** Base64-encoded public encryption key. */
    d: string;
}
