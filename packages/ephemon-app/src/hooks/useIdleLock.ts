import { useCallback, useEffect, useRef, useState } from 'react';

export const IDLE_LIMIT = 5 * 60 * 1000;
export const IDLE_WARN_BEFORE = 60 * 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

export type IdleLock = {
    remaining: number | undefined;
    extend: () => void;
};

export function useIdleLock(enabled: boolean, onLock: () => void, limit: number = IDLE_LIMIT): IdleLock {
    const idleLimit = Math.min(limit, IDLE_LIMIT);
    const warnBefore = Math.min(IDLE_WARN_BEFORE, idleLimit / 2);

    const [remaining, setRemaining] = useState<number | undefined>(undefined);
    const lastActivityRef = useRef(Date.now());
    const onLockRef = useRef(onLock);
    onLockRef.current = onLock;

    const extend = useCallback(() => {
        lastActivityRef.current = Date.now();
        setRemaining(undefined);
    }, []);

    useEffect(() => {
        if (!enabled) return;

        const onActivity = (event: Event) => {
            if (!event.isTrusted) return;
            lastActivityRef.current = Date.now();
            setRemaining((previous) => (previous === undefined ? previous : undefined));
        };
        for (const type of ACTIVITY_EVENTS) {
            document.addEventListener(type, onActivity, { passive: true, capture: true });
        }

        const tick = setInterval(() => {
            const idle = Date.now() - lastActivityRef.current;
            if (idle >= idleLimit) {
                onLockRef.current();
                return;
            }
            const left = idleLimit - idle;
            setRemaining(left <= warnBefore ? left : undefined);
        }, 500);

        return () => {
            clearInterval(tick);
            for (const type of ACTIVITY_EVENTS) {
                document.removeEventListener(type, onActivity, { capture: true });
            }
        };
    }, [enabled, idleLimit, warnBefore]);

    return { remaining, extend };
}
