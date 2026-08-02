export type KeyedStore<T> = {
    subscribe(key: string, listener: () => void): () => void;
    get(key: string): T;
    set(key: string, value: T): void;
    update(key: string, updater: (previous: T) => T): void;
    remove(key: string): void;
};

export function createKeyedStore<T>(fallback: T, equals: (a: T, b: T) => boolean = Object.is): KeyedStore<T> {
    const values = new Map<string, T>();
    const listeners = new Map<string, Set<() => void>>();

    function notify(key: string): void {
        const subscribers = listeners.get(key);
        if (subscribers === undefined) return;
        for (const listener of subscribers) {
            listener();
        }
    }

    return {
        subscribe(key, listener) {
            let subscribers = listeners.get(key);
            if (subscribers === undefined) {
                subscribers = new Set();
                listeners.set(key, subscribers);
            }
            subscribers.add(listener);
            return () => {
                subscribers.delete(listener);
                if (subscribers.size === 0) listeners.delete(key);
            };
        },
        get(key) {
            const value = values.get(key);
            return value === undefined ? fallback : value;
        },
        set(key, value) {
            const previous = values.get(key) ?? fallback;
            if (equals(previous, value)) return;
            values.set(key, value);
            notify(key);
        },
        update(key, updater) {
            this.set(key, updater(values.get(key) ?? fallback));
        },
        remove(key) {
            if (!values.delete(key)) return;
            notify(key);
        },
    };
}

export function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
    if (a === b) return true;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.is(a[key], b[key]));
}
