import { getNetStatus, subscribeNetStatus } from '../lib/netStatusStore';
import { NetStatus } from '../lib/status';
import { useSyncExternalStore } from 'react';

export function useServerNetStatus(): NetStatus {
    return useSyncExternalStore(subscribeNetStatus, getNetStatus);
}
