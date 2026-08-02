import { EncryptionHolderCallData } from './encryption-holder-call-data';

export interface EncryptedCallData extends EncryptionHolderCallData {
    /** Base64-encoded encrypted data payload. */
    e: string;
}
