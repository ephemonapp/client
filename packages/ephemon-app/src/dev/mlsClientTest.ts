import { DirectMlsBootstrapSession } from '../mls/DirectMlsBootstrapSession';
import { MlsWorkerClient } from '../mls/MlsWorkerClient';
import {
    ApplicationEvent,
    applicationEventHash,
    decodeApplicationEvent,
    encodeApplicationEvent,
} from '../mls/applicationEvent';
import { Writer } from '../mls/byteCodec';
import { acceptChatEvent, authorChatEvent } from '../mls/chatEvent';
import {
    assignDirectMlsMembership,
    DirectMlsBootstrapFrame,
    encodeDirectMlsBootstrapFrame,
    encodeDirectMlsWireFrame,
    tryDecodeDirectMlsBootstrapFrame,
    tryDecodeDirectMlsWireFrame,
} from '../mls/directBootstrapProtocol';
import {
    compareHybridLogicalTime,
    MAX_ACCEPTED_FUTURE_SKEW_MS,
    nextLocalHybridLogicalTime,
    observeRemoteHybridLogicalTime,
    requireAcceptableRemoteHybridLogicalTime,
} from '../mls/hybridLogicalClock';
import { LoadedMlsCheckpoint, MlsCheckpointStore } from '../mls/mlsCheckpointStore';
import { ConversationId, toConversationId, toMemberNumber } from '../types/conversation';
import {
    isDateSeparatorId,
    isSelfChatRecordId,
    isMlsEventId,
    mlsEventHash,
    timestampOfRecordId,
    toDateSeparatorId,
    toEventId,
    toSelfChatRecordId,
    toMlsEventId,
} from '../types/eventId';

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
        {
            kind: 'keyPackage',
            routingId,
            keyPackage: Uint8Array.from([0, 1, 2, 255]),
        },
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
    const selfChat = new TextEncoder().encode('{"id":1,"message":{"text":"self chat"}}');
    if (tryDecodeDirectMlsBootstrapFrame(selfChat) !== undefined) {
        throw new Error('A self-chat payload was misclassified as MLS bootstrap control');
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
    const creatorMembership = assignDirectMlsMembership(
        'alice-authenticated-transport-public-key',
        'bob-authenticated-transport-public-key',
    );
    const inviteeMembership = assignDirectMlsMembership(
        'bob-authenticated-transport-public-key',
        'alice-authenticated-transport-public-key',
    );
    const authored = await authorChatEvent(
        { kind: 'text', text: 'after recovery' },
        { sequence: 0 },
        creatorMembership,
        undefined,
        1_754_300_000_000,
    );
    const applicationMessage = await alice.createApplicationMessage(aliceId, authored.bytes);
    const applicationWire = encodeDirectMlsWireFrame({
        kind: 'application',
        routingId: completeFrame.routingId,
        message: applicationMessage,
    });
    const decodedWire = tryDecodeDirectMlsWireFrame(applicationWire);
    if (decodedWire?.kind !== 'application') throw new Error('MLS application wire frame did not round-trip');
    const processed = await bob.processApplicationMessage(bobId, decodedWire.message);
    const accepted = await acceptChatEvent(
        processed.payload,
        processed.senderMemberNumber,
        inviteeMembership,
        1_754_300_000_000,
    );
    if (accepted.kind !== 'record' || accepted.record.kind !== 'message') {
        throw new Error('Recovered bootstrap did not deliver an authenticated message record');
    }
    if (
        processed.senderMemberNumber !== 0 ||
        accepted.record.sender !== 'peer' ||
        accepted.record.id !== authored.id ||
        accepted.record.author !== 0 ||
        accepted.record.sequence !== 0 ||
        accepted.record.text !== 'after recovery'
    ) {
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

function assertRejected(label: string, operation: () => void): void {
    try {
        operation();
    } catch {
        return;
    }
    throw new Error(`${label} was accepted`);
}

function bytesOf(value: Uint8Array): string {
    return Array.from(value).join(',');
}

function assertEventIdentifiers(): void {
    const at = 1_754_300_000_000;
    const authored = toSelfChatRecordId('you', 'message', at);
    const received = toSelfChatRecordId('peer', 'message', at);
    const receipt = toSelfChatRecordId('you', 'seen', at);
    const separator = toDateSeparatorId(at);
    if (!isSelfChatRecordId(authored) || isMlsEventId(authored) || timestampOfRecordId(authored) !== at) {
        throw new Error('A self-chat record identifier did not round-trip');
    }
    if (authored === received || timestampOfRecordId(received) !== at) {
        throw new Error('The two directions of one self-chat timestamp collapsed into one identifier');
    }
    if (authored === receipt || timestampOfRecordId(receipt) !== at) {
        throw new Error('A self-chat receipt shared the identifier of the message authored in the same millisecond');
    }
    if (!isDateSeparatorId(separator) || timestampOfRecordId(separator) !== at) {
        throw new Error('A day separator identifier did not round-trip');
    }
    const hash = Uint8Array.from({ length: 32 }, (_, index) => index * 7);
    const eventId = toMlsEventId(hash);
    if (!isMlsEventId(eventId) || eventId.length !== 45 || bytesOf(mlsEventHash(eventId)) !== bytesOf(hash)) {
        throw new Error('An MLS event identifier did not round-trip its hash');
    }
    assertRejected('A malformed event identifier', () => toEventId('nope'));
    assertRejected('A short MLS event identifier', () => toEventId('m:abc'));
    assertRejected('A self-chat identifier read as an MLS hash', () => mlsEventHash(authored));
    assertRejected('An undersized event hash', () => toMlsEventId(new Uint8Array(31)));
}

function assertHybridLogicalClock(): void {
    const first = nextLocalHybridLogicalTime(undefined, 1000);
    const second = nextLocalHybridLogicalTime(first, 1000);
    if (compareHybridLogicalTime(first, second) >= 0) {
        throw new Error('Two events stamped in the same millisecond did not order by counter');
    }
    const behind = nextLocalHybridLogicalTime({ physical: 5000, counter: 0 }, 1000);
    if (behind.physical !== 5000 || behind.counter !== 1) {
        throw new Error('A backwards wall clock moved the hybrid logical time backwards');
    }
    const observed = observeRemoteHybridLogicalTime({ physical: 900, counter: 4 }, second, 950);
    const authoredAfter = nextLocalHybridLogicalTime(observed, 950);
    if (compareHybridLogicalTime(second, authoredAfter) >= 0) {
        throw new Error('An event authored after observing a remote event did not sort after it');
    }
    requireAcceptableRemoteHybridLogicalTime({ physical: 1000 + MAX_ACCEPTED_FUTURE_SKEW_MS, counter: 0 }, 1000);
    assertRejected('An event stamped beyond the accepted skew', () =>
        requireAcceptableRemoteHybridLogicalTime({ physical: 1001 + MAX_ACCEPTED_FUTURE_SKEW_MS, counter: 0 }, 1000),
    );
}

async function assertApplicationEventCodec(): Promise<void> {
    const targetHash = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const previous = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);
    const time = { physical: 1_754_300_000_000, counter: 3 };
    const events: ReadonlyArray<ApplicationEvent> = [
        {
            time,
            author: toMemberNumber(0),
            chain: { sequence: 0 },
            body: { kind: 'message.created', text: 'first' },
        },
        {
            time,
            author: toMemberNumber(0),
            chain: { sequence: 1, previous },
            body: {
                kind: 'message.created',
                text: 'reply to an event',
                reply: {
                    targetHash,
                    authorMemberNumber: toMemberNumber(1),
                    text: 'quoted',
                },
            },
        },
        {
            time,
            author: toMemberNumber(0),
            chain: { sequence: 2, previous },
            body: {
                kind: 'message.created',
                text: 'reply to another event',
                reply: {
                    targetHash,
                    authorMemberNumber: toMemberNumber(0),
                    text: 'quoted',
                },
            },
        },
        {
            time,
            author: toMemberNumber(0),
            chain: { sequence: 3, previous },
            body: { kind: 'message.delivered', targetHash },
        },
        {
            time,
            author: toMemberNumber(0),
            chain: { sequence: 4, previous },
            body: { kind: 'message.seen', targetHash },
        },
        {
            time,
            author: toMemberNumber(0),
            chain: { sequence: 5, previous },
            body: { kind: 'reaction.set', targetHash, value: '👍' },
        },
        { time, body: { kind: 'typing' } },
    ];

    const identifiers = new Set<string>();
    for (const event of events) {
        const encoded = encodeApplicationEvent(event);
        const decoded = decodeApplicationEvent(encoded);
        if (bytesOf(encodeApplicationEvent(decoded)) !== bytesOf(encoded)) {
            throw new Error(`An ${event.body.kind} event did not round-trip canonically`);
        }
        identifiers.add(toMlsEventId(await applicationEventHash(encoded)));
        assertRejected(`An ${event.body.kind} event with trailing bytes`, () =>
            decodeApplicationEvent(Uint8Array.from([...encoded, 0])),
        );
        assertRejected(`A truncated ${event.body.kind} event`, () =>
            decodeApplicationEvent(encoded.slice(0, encoded.byteLength - 1)),
        );
        const wrongVersion = Uint8Array.from(encoded);
        wrongVersion[0] = 2;
        assertRejected(`An ${event.body.kind} event of an unsupported version`, () =>
            decodeApplicationEvent(wrongVersion),
        );
        const wrongKind = Uint8Array.from(encoded);
        wrongKind[1] = 99;
        assertRejected('An event of an unknown kind', () => decodeApplicationEvent(wrongKind));
    }
    if (identifiers.size !== events.length) throw new Error('Distinct application events shared one identifier');

    const original = encodeApplicationEvent(events[0]);
    const repeated = encodeApplicationEvent(events[0]);
    if (bytesOf(await applicationEventHash(original)) !== bytesOf(await applicationEventHash(repeated))) {
        throw new Error('The same application event produced two identifiers');
    }

    assertRejected('An event whose sequence omits its predecessor', () =>
        encodeApplicationEvent({
            time,
            author: toMemberNumber(0),
            chain: { sequence: 9 },
            body: { kind: 'message.created', text: 'orphan' },
        }),
    );

    const orphan = new Writer();
    orphan.u8(1);
    orphan.u8(1);
    orphan.u64(1n);
    orphan.u32(0);
    orphan.u64(9n);
    orphan.u8(0);
    const orphanBody = new Writer();
    orphanBody.variable(new TextEncoder().encode('orphan'));
    orphanBody.u8(0);
    orphan.variable(orphanBody.finish());
    assertRejected('A decoded event whose sequence omits its predecessor', () =>
        decodeApplicationEvent(orphan.finish()),
    );

    const unknownReply = new Writer();
    unknownReply.u8(1);
    unknownReply.u8(1);
    unknownReply.u64(1n);
    unknownReply.u32(0);
    unknownReply.u64(0n);
    unknownReply.u8(0);
    const unknownReplyBody = new Writer();
    unknownReplyBody.variable(new TextEncoder().encode('text'));
    unknownReplyBody.u8(3);
    unknownReply.variable(unknownReplyBody.finish());
    assertRejected('An event with an unknown reply presence', () => decodeApplicationEvent(unknownReply.finish()));
}

async function runMlsClientTest(): Promise<{
    epoch: string;
    roster: ReadonlyArray<number>;
    checkpoints: Record<string, { revision: number; bytes: number }>;
}> {
    assertDirectBootstrapProtocol();
    assertEventIdentifiers();
    assertHybridLogicalClock();
    await assertApplicationEventCodec();
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
    const bobCommit = await bob.createSelfUpdate(bobId);
    await bob.mergePendingCommit(bobId);
    let refused = false;
    try {
        await alice.processIncomingCommit(aliceId, bobCommit, [toMemberNumber(0)]);
    } catch {
        refused = true;
    }
    if (!refused) throw new Error('An unauthorized commit was merged');
    const refusedInspection = await alice.inspect(aliceId);
    if (refusedInspection.epoch !== 1n) throw new Error('A refused commit advanced the epoch');

    const authorized = await alice.processIncomingCommit(aliceId, bobCommit, [toMemberNumber(0), toMemberNumber(1)]);
    if (authorized.senderMemberNumber !== 1 || authorized.epoch !== 2n) {
        throw new Error('An authorized commit did not merge at the next epoch');
    }
    const aliceHead = (await alice.inspect(aliceId)).epochAuthenticator;
    const bobHead = (await bob.inspect(bobId)).epochAuthenticator;
    if (aliceHead === undefined || bobHead === undefined || bytesOf(aliceHead) !== bytesOf(bobHead)) {
        throw new Error('Both members must agree on the epoch head after a commit');
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
