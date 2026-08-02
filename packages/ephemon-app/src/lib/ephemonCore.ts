import type { Ephemon } from '@ephemon/core';

let core: Ephemon | undefined;

export function setEphemonCore(value: Ephemon): void {
    core = value;
}

export function getEphemonCore(): Ephemon | undefined {
    return core;
}

export function hasEphemonCore(): boolean {
    return core !== undefined && core !== null;
}

export function requireEphemonCore(): Ephemon {
    if (core === undefined || core === null) {
        throw new Error('[ephemon] The core has not been initialized yet.');
    }
    return core;
}
