import { CallData } from './call-data';

export interface TransmittableCallData extends CallData {
    b: number;

    /** Used to ensure messages are only processed by the intended recipient. */
    c: string;
}
