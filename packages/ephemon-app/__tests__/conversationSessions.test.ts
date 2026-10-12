import { createConversationSessions } from '../src/mls/conversationSessions';
import { toConversationId } from '../src/types/conversation';

const ONE = toConversationId(1);
const TWO = toConversationId(2);

function fill(sessions: ReturnType<typeof createConversationSessions>, id: number): void {
    const conversation = toConversationId(id);
    sessions.ready.set(conversation, {} as never);
    sessions.readyWaiters.set(conversation, new Set());
    sessions.bootstraps.set(conversation, new Map());
    sessions.inviteJoiners.set(conversation, {} as never);
    sessions.inviteOwners.set(`${conversation}:peer-key`, {} as never);
    sessions.offlineAuthoring.set(conversation, {} as never);
    sessions.seenPayloads.set(conversation, new Set(['hash']));
    sessions.deferred.set(conversation, [Uint8Array.of(1)]);
    sessions.catchUpAsked.set(conversation, 1_000);
    sessions.reconciles.set(conversation, Promise.resolve());
    sessions.rekeys.set(conversation, Promise.resolve());
    sessions.commitQueue.set(conversation, Promise.resolve());
    sessions.dialled.add(conversation);
    sessions.routes.set(`routing-${conversation}`, conversation);
}

describe('conversation sessions', () => {
    it('forgets everything a deleted conversation held, so a reused id inherits nothing', () => {
        const sessions = createConversationSessions();
        fill(sessions, 1);

        sessions.forget(ONE);

        expect(sessions.ready.size).toBe(0);
        expect(sessions.readyWaiters.size).toBe(0);
        expect(sessions.bootstraps.size).toBe(0);
        expect(sessions.inviteJoiners.size).toBe(0);
        expect(sessions.inviteOwners.size).toBe(0);
        expect(sessions.offlineAuthoring.size).toBe(0);
        expect(sessions.seenPayloads.size).toBe(0);
        expect(sessions.deferred.size).toBe(0);
        expect(sessions.catchUpAsked.size).toBe(0);
        expect(sessions.reconciles.size).toBe(0);
        expect(sessions.rekeys.size).toBe(0);
        expect(sessions.commitQueue.size).toBe(0);
        expect(sessions.dialled.size).toBe(0);
        expect(sessions.routes.size).toBe(0);
    });

    it('leaves every other conversation alone', () => {
        const sessions = createConversationSessions();
        fill(sessions, 1);
        fill(sessions, 2);

        sessions.forget(ONE);

        expect([...sessions.ready.keys()]).toEqual([TWO]);
        expect([...sessions.inviteOwners.keys()]).toEqual(['2:peer-key']);
        expect([...sessions.routes.values()]).toEqual([TWO]);
        expect(sessions.dialled.has(TWO)).toBe(true);
    });

    it('drops the MLS state a locked vault invalidates and keeps the rest', () => {
        const sessions = createConversationSessions();
        fill(sessions, 1);

        sessions.forgetMlsState();

        expect(sessions.ready.size).toBe(0);
        expect(sessions.bootstraps.size).toBe(0);
        expect(sessions.inviteOwners.size).toBe(0);
        expect(sessions.inviteJoiners.size).toBe(0);
        expect(sessions.readyWaiters.size).toBe(0);
        expect(sessions.offlineAuthoring.size).toBe(0);
        expect(sessions.routes.size).toBe(1);
        expect(sessions.deferred.size).toBe(1);
        expect(sessions.reconciles.size).toBe(0);
        expect(sessions.commitQueue.size).toBe(0);
        expect(sessions.dialled.size).toBe(1);
    });
});
