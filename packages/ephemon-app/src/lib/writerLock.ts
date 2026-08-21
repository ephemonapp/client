const LOCK_NAME = 'ephemon-mls-writer';

export type WriterLockState = 'pending' | 'writer' | 'unsupported';

type LockManager = {
    request(name: string, options: { mode: 'exclusive' }, callback: () => Promise<void>): Promise<void>;
};

function manager(): LockManager | undefined {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    return typeof locks?.request === 'function' ? locks : undefined;
}

export function isWriterLockSupported(): boolean {
    return manager() !== undefined;
}

export function acquireWriterLock(onAcquired: () => void): () => void {
    const locks = manager();
    if (locks === undefined) {
        onAcquired();
        return () => {};
    }
    let released = false;
    let release: (() => void) | undefined;
    locks
        .request(LOCK_NAME, { mode: 'exclusive' }, () => {
            if (released) return Promise.resolve();
            onAcquired();
            return new Promise<void>((resolve) => {
                release = resolve;
            });
        })
        .catch(() => {});
    return () => {
        released = true;
        release?.();
    };
}
