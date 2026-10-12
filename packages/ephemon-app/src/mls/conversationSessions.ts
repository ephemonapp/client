import { ConversationId } from '../types/conversation';
import { DirectMlsBootstrapResult, DirectMlsBootstrapSession } from './DirectMlsBootstrapSession';
import { MlsInviteJoinerSession, MlsInviteOwnerSession } from './MlsInviteSession';

export type ReadyWaiter = {
    resolve(result: DirectMlsBootstrapResult): void;
    reject(error: Error): void;
};

/** Per-conversation state held outside the vault. */
export type ConversationSessions = ReturnType<typeof createConversationSessions>;

export function createConversationSessions() {
    const ready = new Map<ConversationId, DirectMlsBootstrapResult>();
    const readyWaiters = new Map<ConversationId, Set<ReadyWaiter>>();
    const restores = new Map<ConversationId, Promise<DirectMlsBootstrapResult | undefined>>();
    const bootstraps = new Map<ConversationId, Map<string, DirectMlsBootstrapSession>>();
    const inviteOwners = new Map<string, MlsInviteOwnerSession>();
    const inviteJoiners = new Map<ConversationId, MlsInviteJoinerSession>();
    const reservedNumbers = new Map<ConversationId, Set<number>>();
    const offlineAuthoring = new Map<ConversationId, DirectMlsBootstrapResult>();
    const seenPayloads = new Map<ConversationId, Set<string>>();
    const deferred = new Map<ConversationId, Array<Uint8Array>>();
    const catchUpAsked = new Map<ConversationId, number>();
    const reconciles = new Map<ConversationId, Promise<void>>();
    const queuedReconciles = new Map<ConversationId, Promise<void>>();
    const rekeys = new Map<ConversationId, Promise<void>>();
    const commitQueue = new Map<ConversationId, Promise<unknown>>();
    const dialled = new Set<ConversationId>();
    const routes = new Map<string, ConversationId>();

    return {
        ready,
        readyWaiters,
        restores,
        bootstraps,
        inviteOwners,
        inviteJoiners,
        reservedNumbers,
        offlineAuthoring,
        seenPayloads,
        deferred,
        catchUpAsked,
        reconciles,
        queuedReconciles,
        rekeys,
        commitQueue,
        dialled,
        routes,

        /** Publishes a conversation's MLS state and releases whoever was waiting for it. */
        markReady(id: ConversationId, result: DirectMlsBootstrapResult): void {
            ready.set(id, result);
            const waiters = readyWaiters.get(id);
            if (waiters === undefined) return;
            readyWaiters.delete(id);
            for (const waiter of waiters) waiter.resolve(result);
        },

        failWaiters(error: Error, id?: ConversationId): void {
            for (const [key, waiters] of [...readyWaiters]) {
                if (id !== undefined && key !== id) continue;
                readyWaiters.delete(key);
                for (const waiter of waiters) waiter.reject(error);
            }
        },

        forget(id: ConversationId): void {
            ready.delete(id);
            this.failWaiters(new Error(`Conversation ${id} was forgotten`), id);
            restores.delete(id);
            bootstraps.delete(id);
            inviteJoiners.delete(id);
            reservedNumbers.delete(id);
            offlineAuthoring.delete(id);
            seenPayloads.delete(id);
            deferred.delete(id);
            catchUpAsked.delete(id);
            reconciles.delete(id);
            queuedReconciles.delete(id);
            rekeys.delete(id);
            commitQueue.delete(id);
            dialled.delete(id);
            for (const key of [...inviteOwners.keys()]) {
                if (key.startsWith(`${id}:`)) inviteOwners.delete(key);
            }
            for (const [key, routed] of [...routes]) {
                if (routed === id) routes.delete(key);
            }
        },

        /** Drops the MLS state a locked vault invalidates, keeping routes, queues and dial history. */
        /**
         * Drops what a closed worker session invalidates. Deferred ciphertexts and seen-payload hashes outlive it on
         * purpose -- the group is restored from the same checkpoint -- but a promise that was in flight when the vault
         * locked will never settle, and `sendMessage` awaits those.
         */
        forgetMlsState(): void {
            bootstraps.clear();
            inviteOwners.clear();
            inviteJoiners.clear();
            ready.clear();
            restores.clear();
            this.failWaiters(new Error('The vault was locked before MLS became ready'));
            offlineAuthoring.clear();
            reconciles.clear();
            queuedReconciles.clear();
            rekeys.clear();
            commitQueue.clear();
            reservedNumbers.clear();
        },
    };
}
