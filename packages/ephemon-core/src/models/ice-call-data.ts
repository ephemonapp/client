import { IceSource } from './ice-source';
import { EncryptedCallData } from './infrasctructure/encrypted-call-data';

export interface IceCallData extends EncryptedCallData {
    f: IceSource;
}
