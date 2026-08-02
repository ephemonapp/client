export interface CallResponse {
    ok: boolean;

    timestamp: number;

    /** Present only when 'ok' is false. */
    reason?: string;

    errors?: string[];
}
