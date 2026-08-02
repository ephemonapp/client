import { getVault } from '../lib/vault';
import { VaultBlockedError, VaultStaleError, VaultUnavailableError } from '../utils/database';
import { useEffect, useState } from 'react';

export type PasswordState =
    undefined | 'none' | 'valid' | 'invalid' | 'migrating' | 'blocked' | 'stale' | 'unavailable' | 'error';

export function usePasswordCheck(password: string | undefined): PasswordState {
    const database = getVault();

    const [passwordState, setPasswordState] = useState<PasswordState>();

    useEffect(() => {
        if (password === undefined && database.isUnlocked()) return;

        let cancelled = false;
        setPasswordState(undefined);

        database
            .unlock(password || '', {
                onMigrating: () => {
                    if (!cancelled) setPasswordState('migrating');
                },
            })
            .then((result) => {
                if (!cancelled) setPasswordState(result);
            })
            .catch((error) => {
                if (cancelled) return;
                if (error instanceof VaultBlockedError) setPasswordState('blocked');
                else if (error instanceof VaultStaleError) setPasswordState('stale');
                else if (error instanceof VaultUnavailableError) setPasswordState('unavailable');
                else setPasswordState('error');
            });

        return () => {
            cancelled = true;
        };
    }, [password, database]);

    return passwordState;
}
