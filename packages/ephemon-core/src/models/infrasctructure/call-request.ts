import { CallData } from './call-data';
import { CallMethodName } from './call-method-name';

export interface CallRequestBase {
    a: CallMethodName;

    c: string;
}

export interface CallRequest<TypeData extends CallData> extends CallRequestBase {
    b: TypeData;
}
