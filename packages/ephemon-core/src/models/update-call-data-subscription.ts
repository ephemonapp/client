import { UpdateCallDataSubscriptionKeys } from './update-call-data-subscription-keys';

export interface UpdateCallDataSubscription {
    a: string;

    b: number | null;

    /** Ensures that only the intended recipient can decrypt and read the notification content. */
    c: UpdateCallDataSubscriptionKeys;
}
