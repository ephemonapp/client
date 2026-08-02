import { CallData } from './infrasctructure/call-data';
import { UpdateCallDataSubscription } from './update-call-data-subscription';

export interface UpdateCallData extends CallData {
    b?: UpdateCallDataSubscription;
}
