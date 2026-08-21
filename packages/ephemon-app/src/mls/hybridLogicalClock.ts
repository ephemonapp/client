/** Server-anchored wall clock plus a logical counter; `physical` is also the rendered send time. */
export type HybridLogicalTime = {
    readonly physical: number;
    readonly counter: number;
};

const MAX_COUNTER = 0xffffffff;

export const MAX_ACCEPTED_FUTURE_SKEW_MS = 5 * 60 * 1000;

export function compareHybridLogicalTime(a: HybridLogicalTime, b: HybridLogicalTime): number {
    if (a.physical !== b.physical) return a.physical < b.physical ? -1 : 1;
    if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
    return 0;
}

function advance(physical: number, counter: number): HybridLogicalTime {
    return counter > MAX_COUNTER ? { physical: physical + 1, counter: 0 } : { physical, counter };
}

export function nextLocalHybridLogicalTime(
    previous: HybridLogicalTime | undefined,
    physicalNow: number,
): HybridLogicalTime {
    if (previous === undefined || physicalNow > previous.physical) return { physical: physicalNow, counter: 0 };
    return advance(previous.physical, previous.counter + 1);
}

export function observeRemoteHybridLogicalTime(
    previous: HybridLogicalTime | undefined,
    remote: HybridLogicalTime,
    physicalNow: number,
): HybridLogicalTime {
    const localPhysical = previous?.physical ?? 0;
    const physical = Math.max(localPhysical, remote.physical, physicalNow);
    if (physical === localPhysical && physical === remote.physical) {
        return advance(physical, Math.max(previous?.counter ?? 0, remote.counter) + 1);
    }
    if (physical === localPhysical) return advance(physical, (previous?.counter ?? 0) + 1);
    if (physical === remote.physical) return advance(physical, remote.counter + 1);
    return { physical, counter: 0 };
}

/** Rejects instead of clamping: the value is inside the event hash. */
export function requireAcceptableRemoteHybridLogicalTime(remote: HybridLogicalTime, physicalNow: number): void {
    if (remote.physical - physicalNow > MAX_ACCEPTED_FUTURE_SKEW_MS) {
        throw new RangeError(
            `An application event is stamped ${remote.physical - physicalNow}ms in the future and was rejected`,
        );
    }
}
