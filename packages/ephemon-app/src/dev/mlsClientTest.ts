import { DirectMlsBootstrapSession } from '../mls/DirectMlsBootstrapSession';
import { MlsWorkerClient } from '../mls/MlsWorkerClient';
import { decodeDirectMlsChatUpdate, encodeDirectMlsChatUpdate } from '../mls/directApplicationProtocol';
import {
    assignDirectMlsMembership,
    DirectMlsBootstrapFrame,
    encodeDirectMlsBootstrapFrame,
    encodeDirectMlsWireFrame,
    tryDecodeDirectMlsBootstrapFrame,
    tryDecodeDirectMlsWireFrame,
} from '../mls/directBootstrapProtocol';
import { LoadedMlsCheckpoint, MlsCheckpointStore } from '../mls/mlsCheckpointStore';
import { ConversationId, toConversationId, toMemberNumber } from '../types/conversation';

class MemoryCheckpointStore implements MlsCheckpointStore {
    private readonly values = new Map<ConversationId, LoadedMlsCheckpoint>();
    private failConversation: ConversationId | undefined;

    failNextSave(conversationId: ConversationId): void {
        this.failConversation = conversationId;
    }

    load(conversationId: ConversationId): Promise<LoadedMlsCheckpoint | null> {
        const value = this.values.get(conversationId);
        return Promise.resolve(
            value === undefined
                ? null
                : {
                      revision: value.revision,
                      bytes: Uint8Array.from(value.bytes),
                      companion: value.companion === undefined ? undefined : Uint8Array.from(value.companion),
                  },
        );
    }

    save(
        conversationId: ConversationId,
        expectedRevision: number | null,
        bytes: Uint8Array,
        companion?: Uint8Array,
    ): Promise<number> {
        if (this.failConversation === conversationId) {
            this.failConversation = undefined;
            return Promise.reject(new Error('injected checkpoint write failure'));
        }
        const current = this.values.get(conversationId);
        if ((current?.revision ?? null) !== expectedRevision) {
            return Promise.reject(new Error('stale in-memory checkpoint writer'));
        }
        const revision = (expectedRevision ?? 0) + 1;
        this.values.set(conversationId, {
            revision,
            bytes: Uint8Array.from(bytes),
            companion: companion === undefined ? undefined : Uint8Array.from(companion),
        });
        return Promise.resolve(revision);
    }

    delete(conversationId: ConversationId): Promise<void> {
        this.values.delete(conversationId);
        return Promise.resolve();
    }

    metrics(): Record<string, { revision: number; bytes: number }> {
        return Object.fromEntries(
            [...this.values].map(([conversationId, value]) => [
                conversationId,
                { revision: value.revision, bytes: value.bytes.byteLength },
            ]),
        );
    }
}

function assertDirectBootstrapProtocol(): void {
    const routingId = Uint8Array.from({ length: 32 }, (_, index) => index);
    const groupId = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    const frames: ReadonlyArray<DirectMlsBootstrapFrame> = [
        { kind: 'hello', minimumVersion: 1, maximumVersion: 1 },
        { kind: 'initialize', routingId, groupId },
        { kind: 'keyPackage', routingId, keyPackage: Uint8Array.from([0, 1, 2, 255]) },
        {
            kind: 'addMember',
            routingId,
            commit: Uint8Array.from([3, 4, 5]),
            welcome: Uint8Array.from([6, 7, 8, 9]),
        },
        { kind: 'joined', routingId, epoch: 1n },
        { kind: 'complete', routingId, epoch: 1n },
    ];
    for (const frame of frames) {
        const encoded = encodeDirectMlsBootstrapFrame(frame);
        const decoded = tryDecodeDirectMlsBootstrapFrame(encoded);
        if (decoded === undefined || decoded.kind !== frame.kind) {
            throw new Error(`Direct MLS bootstrap ${frame.kind} did not round-trip`);
        }
        const reencoded = encodeDirectMlsBootstrapFrame(decoded);
        if (Array.from(reencoded).join(',') !== Array.from(encoded).join(',')) {
            throw new Error(`Direct MLS bootstrap ${frame.kind} was not canonically encoded`);
        }
    }
    const legacy = new TextEncoder().encode('{"id":1,"message":{"text":"legacy"}}');
    if (tryDecodeDirectMlsBootstrapFrame(legacy) !== undefined) {
        throw new Error('Legacy chat payload was misclassified as MLS bootstrap control');
    }
    const application = encodeDirectMlsWireFrame({
        kind: 'application',
        routingId,
        message: Uint8Array.from([10, 11, 12]),
    });
    const decodedApplication = tryDecodeDirectMlsWireFrame(application);
    if (
        decodedApplication?.kind !== 'application' ||
        decodedApplication.message.join(',') !== '10,11,12' ||
        tryDecodeDirectMlsBootstrapFrame(application) !== undefined
    ) {
        throw new Error('MLS application frame was not separated from bootstrap control');
    }
    const alice = assignDirectMlsMembership('alice-public-key', 'bob-public-key');
    const bob = assignDirectMlsMembership('bob-public-key', 'alice-public-key');
    if (
        alice.role !== 'creator' ||
        alice.ownMemberNumber !== 0 ||
        bob.role !== 'invitee' ||
        bob.ownMemberNumber !== 1
    ) {
        throw new Error('Direct MLS membership election did not converge');
    }
}

async function runDirectBootstrapRecoveryTest(store: MemoryCheckpointStore): Promise<void> {
    const aliceId = toConversationId(210);
    const bobId = toConversationId(211);
    const aliceMembership = assignDirectMlsMembership(
        'alice-authenticated-transport-public-key',
        'bob-authenticated-transport-public-key',
    );
    const bobMembership = assignDirectMlsMembership(
        'bob-authenticated-transport-public-key',
        'alice-authenticated-transport-public-key',
    );
    let toAlice: Array<Uint8Array> = [];
    let toBob: Array<Uint8Array> = [];
    const captured: Array<Uint8Array> = [];
    let aliceCompleted = 0;
    let bobCompleted = 0;
    let alice = new MlsWorkerClient(store);
    let bob = new MlsWorkerClient(store);
    let aliceBootstrap = new DirectMlsBootstrapSession({
        conversationId: aliceId,
        membership: aliceMembership,
        mls: alice,
        send: (frame) => {
            captured.push(Uint8Array.from(frame));
            toBob.push(Uint8Array.from(frame));
        },
        onComplete: () => aliceCompleted++,
    });
    let bobBootstrap = new DirectMlsBootstrapSession({
        conversationId: bobId,
        membership: bobMembership,
        mls: bob,
        send: (frame) => {
            captured.push(Uint8Array.from(frame));
            toAlice.push(Uint8Array.from(frame));
        },
        onComplete: () => bobCompleted++,
    });

    await Promise.all([aliceBootstrap.start(), bobBootstrap.start()]);
    const initialFrameCounts = [toAlice.length, toBob.length];
    await Promise.all([aliceBootstrap.start(), bobBootstrap.start()]);
    if (toAlice.length !== initialFrameCounts[0] || toBob.length !== initialFrameCounts[1]) {
        throw new Error('Repeated bootstrap start emitted another hello and can amplify peer control traffic');
    }
    const deliverOne = async (): Promise<boolean> => {
        const aliceFrame = toAlice.shift();
        if (aliceFrame !== undefined) {
            if (!(await aliceBootstrap.receive(aliceFrame))) throw new Error('Alice rejected an MLS bootstrap frame');
            return true;
        }
        const bobFrame = toBob.shift();
        if (bobFrame !== undefined) {
            if (!(await bobBootstrap.receive(bobFrame))) throw new Error('Bob rejected an MLS bootstrap frame');
            return true;
        }
        return false;
    };

    for (let step = 0; step < 20 && aliceBootstrap.phase !== 'complete'; step++) {
        if (!(await deliverOne())) break;
    }
    if (aliceBootstrap.phase !== 'complete' || bobBootstrap.phase !== 'awaiting-complete') {
        throw new Error(
            `Bootstrap did not reach recoverable ack boundary: ${aliceBootstrap.phase}/${bobBootstrap.phase}`,
        );
    }

    // Drop the creator's final acknowledgement and replace both browser workers.
    // Their only recovery input is the checkpoint plus its atomically stored outbound frame.
    toAlice = [];
    toBob = [];
    alice.close();
    bob.close();
    alice = new MlsWorkerClient(store);
    bob = new MlsWorkerClient(store);
    aliceCompleted = 0;
    bobCompleted = 0;
    aliceBootstrap = new DirectMlsBootstrapSession({
        conversationId: aliceId,
        membership: aliceMembership,
        mls: alice,
        send: (frame) => toBob.push(Uint8Array.from(frame)),
        onComplete: () => aliceCompleted++,
    });
    bobBootstrap = new DirectMlsBootstrapSession({
        conversationId: bobId,
        membership: bobMembership,
        mls: bob,
        send: (frame) => toAlice.push(Uint8Array.from(frame)),
        onComplete: () => bobCompleted++,
    });
    await Promise.all([aliceBootstrap.start(), bobBootstrap.start()]);

    for (let step = 0; step < 20 && (toAlice.length > 0 || toBob.length > 0); step++) {
        await deliverOne();
    }
    if (
        aliceBootstrap.phase !== 'complete' ||
        bobBootstrap.phase !== 'complete' ||
        aliceCompleted !== 1 ||
        bobCompleted !== 1
    ) {
        throw new Error('Direct MLS bootstrap did not resume idempotently after both workers restarted');
    }
    const aliceInspection = await alice.inspect(aliceId);
    const bobInspection = await bob.inspect(bobId);
    if (
        aliceInspection.epoch !== 1n ||
        bobInspection.epoch !== 1n ||
        aliceInspection.memberNumbers?.join(',') !== '0,1' ||
        bobInspection.memberNumbers?.join(',') !== '0,1'
    ) {
        throw new Error('Recovered direct MLS bootstrap produced different group states');
    }
    const persistedComplete = alice.getCheckpointCompanion(aliceId);
    const completeFrame =
        persistedComplete === undefined ? undefined : tryDecodeDirectMlsBootstrapFrame(persistedComplete);
    if (completeFrame?.kind !== 'complete') throw new Error('Creator did not retain its completed routing ID');
    const applicationJson = JSON.stringify({ id: 1, message: { timestamp: 1, text: 'after recovery' } });
    const applicationPayload = encodeDirectMlsChatUpdate(applicationJson);
    const applicationMessage = await alice.createApplicationMessage(aliceId, applicationPayload);
    const applicationWire = encodeDirectMlsWireFrame({
        kind: 'application',
        routingId: completeFrame.routingId,
        message: applicationMessage,
    });
    const decodedWire = tryDecodeDirectMlsWireFrame(applicationWire);
    if (decodedWire?.kind !== 'application') throw new Error('MLS application wire frame did not round-trip');
    const processed = await bob.processApplicationMessage(bobId, decodedWire.message);
    if (processed.senderMemberNumber !== 0 || decodeDirectMlsChatUpdate(processed.payload) !== applicationJson) {
        throw new Error('Recovered bootstrap did not authenticate the creator as member 0');
    }
    let duplicateRejected = false;
    try {
        await bob.processApplicationMessage(bobId, decodedWire.message);
    } catch {
        duplicateRejected = true;
    }
    if (!duplicateRejected) throw new Error('OpenMLS accepted a replayed direct application message');
    const capturedText = captured.map((frame) => new TextDecoder().decode(frame)).join('');
    if (
        capturedText.includes('alice-authenticated-transport-public-key') ||
        capturedText.includes('bob-authenticated-transport-public-key')
    ) {
        throw new Error('Direct MLS bootstrap frame exposed a transport public key');
    }
    alice.close();
    bob.close();
}

async function runMlsClientTest(): Promise<{
    epoch: string;
    roster: ReadonlyArray<number>;
    checkpoints: Record<string, { revision: number; bytes: number }>;
}> {
    assertDirectBootstrapProtocol();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const aliceId = toConversationId(200);
    const bobId = toConversationId(201);
    const rollbackId = toConversationId(202);
    const closedId = toConversationId(203);
    const store = new MemoryCheckpointStore();

    await runDirectBootstrapRecoveryTest(store);

    let alice = new MlsWorkerClient(store);
    let bob = new MlsWorkerClient(store);
    await alice.initialize(aliceId, toMemberNumber(0));
    await bob.initialize(bobId, toMemberNumber(1));
    const creatorCompanion = encoder.encode('creator-initialized');
    await alice.createGroup(aliceId, encoder.encode('ephemon-typed-client-test'), creatorCompanion);
    const keyPackage = await bob.createKeyPackage(bobId, (bytes) =>
        Uint8Array.from([...encoder.encode('invitee-key-package:'), ...bytes]),
    );
    let stagedCompanionBytes = 0;
    const { welcome } = await alice.stageAddMember(aliceId, keyPackage, ({ commit, welcome: stagedWelcome }) => {
        const companion = Uint8Array.from([...commit, ...stagedWelcome]);
        stagedCompanionBytes = companion.byteLength;
        return companion;
    });
    if (alice.getCheckpointCompanion(aliceId)?.byteLength !== stagedCompanionBytes) {
        throw new Error('MLS checkpoint companion was not replaced atomically with staged add artifacts');
    }
    await alice.mergePendingCommit(aliceId);
    await bob.joinFromWelcome(bobId, welcome);

    const firstPlaintext = encoder.encode('typed client before restart');
    const firstMessage = await alice.createApplicationMessage(aliceId, firstPlaintext);
    const firstProcessed = await bob.processApplicationMessage(bobId, firstMessage);
    if (
        firstProcessed.senderMemberNumber !== 0 ||
        decoder.decode(firstProcessed.payload) !== decoder.decode(firstPlaintext)
    ) {
        throw new Error('Typed MLS client did not authenticate Alice before restart');
    }

    const rollbackClient = new MlsWorkerClient(store);
    await rollbackClient.initialize(rollbackId, toMemberNumber(7));
    store.failNextSave(rollbackId);
    let failed = false;
    try {
        await rollbackClient.createGroup(rollbackId, encoder.encode('rolled-back-group'));
    } catch {
        failed = true;
    }
    if (!failed) throw new Error('Injected MLS checkpoint failure did not reject the mutation');
    const rolledBack = await rollbackClient.inspect(rollbackId);
    if (rolledBack.epoch !== undefined) throw new Error('Failed checkpoint mutation was not rolled back');
    rollbackClient.close();

    const closedClient = new MlsWorkerClient(store);
    closedClient.close();
    let closedRejected = false;
    try {
        await closedClient.initialize(closedId, toMemberNumber(8));
    } catch {
        closedRejected = true;
    }
    if (!closedRejected) throw new Error('Closed MLS worker client accepted a new operation');

    alice.close();
    bob.close();
    alice = new MlsWorkerClient(store);
    bob = new MlsWorkerClient(store);
    await alice.initialize(aliceId, toMemberNumber(0));
    await bob.initialize(bobId, toMemberNumber(1));
    const secondPlaintext = encoder.encode('typed client after restart');
    const secondMessage = await bob.createApplicationMessage(bobId, secondPlaintext);
    const secondProcessed = await alice.processApplicationMessage(aliceId, secondMessage);
    if (
        secondProcessed.senderMemberNumber !== 1 ||
        decoder.decode(secondProcessed.payload) !== decoder.decode(secondPlaintext)
    ) {
        throw new Error('Typed MLS client did not authenticate Bob after restart');
    }
    const inspection = await alice.inspect(aliceId);
    alice.close();
    bob.close();
    return {
        epoch: inspection.epoch?.toString() ?? '',
        roster: inspection.memberNumbers ?? [],
        checkpoints: store.metrics(),
    };
}

declare global {
    interface Window {
        runMlsClientTest(): ReturnType<typeof runMlsClientTest>;
    }
}

window.runMlsClientTest = runMlsClientTest;
