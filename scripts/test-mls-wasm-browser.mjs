import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import process from 'node:process';

const facade = await readFile(resolve(process.cwd(), 'packages/ephemon-mls/src/lib.rs'), 'utf8');
const declaredAbiVersion = /pub const ABI_VERSION: u32 = (\d+);/.exec(facade);
if (declaredAbiVersion === null) throw new Error('Could not read ABI_VERSION from the MLS facade');
const expectedAbiVersion = Number(declaredAbiVersion[1]);
const applicationDirectory = resolve(process.cwd(), 'packages/ephemon-app/dist');
const glue = await readFile(resolve(applicationDirectory, 'mls.min.js'));
const wasm = await readFile(resolve(applicationDirectory, 'mls.wasm'));
const workerScript = await readFile(resolve(process.cwd(), 'packages/ephemon-app/dist/mls.worker.js'));
const storageTestScript = await readFile(resolve(process.cwd(), 'packages/ephemon-app/dist/mls.storage-test.js'));
const clientTestScript = await readFile(resolve(process.cwd(), 'packages/ephemon-app/dist/mls.client-test.js'));
const coreScript = await readFile(resolve(process.cwd(), 'packages/ephemon-app/dist/core.min.js'));

const server = createServer((request, response) => {
    if (request.url === '/mls.min.js') {
        response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
        response.end(glue);
        return;
    }
    if (request.url === '/mls.wasm') {
        response.writeHead(200, { 'content-type': 'application/wasm', 'cache-control': 'no-store' });
        response.end(wasm);
        return;
    }
    if (request.url === '/mls.worker.js') {
        response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
        response.end(workerScript);
        return;
    }
    if (request.url === '/mls.storage-test.js') {
        response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
        response.end(storageTestScript);
        return;
    }
    if (request.url === '/mls.client-test.js') {
        response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
        response.end(clientTestScript);
        return;
    }
    if (request.url === '/core.min.js') {
        response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
        response.end(coreScript);
        return;
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    response.end('<!doctype html><html><body>Ephemon MLS WASM smoke test</body></html>');
});
await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Could not bind MLS WASM test server');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
    const page = await browser.newPage();
    await page.goto(origin);
    await page.addScriptTag({ url: `${origin}/mls.storage-test.js` });
    const storageResult = await page.evaluate(() => window.runMlsStorageTest());
    await page.addScriptTag({ url: `${origin}/core.min.js` });
    await page.addScriptTag({ url: `${origin}/mls.client-test.js` });
    const clientResult = await page.evaluate(() => window.runMlsClientTest());
    await page.addScriptTag({ url: `${origin}/mls.min.js` });
    const result = await page.evaluate(
        async ({ expectedAbiVersion }) => {
            const exports = await wasm_bindgen({ module_or_path: '/mls.wasm' });
            const actualAbiVersion = exports.ephemon_mls_abi_version();
            if (actualAbiVersion !== expectedAbiVersion) {
                throw new Error(`Expected MLS WASM ABI ${expectedAbiVersion}, received ${actualAbiVersion}`);
            }

            const { EphemonMlsClient } = wasm_bindgen;
            const encoder = new TextEncoder();
            const decoder = new TextDecoder('utf-8', { fatal: true });

            // The member number lives in the credential as four big-endian bytes; the app owns that encoding, and the
            // facade only carries the bytes, so this harness spells it out rather than asking the facade.
            const identityOf = (memberNumber) => new Uint8Array([0, 0, 0, memberNumber]);
            const numberOf = (identity) => new DataView(identity.buffer, identity.byteOffset, 4).getUint32(0, false);
            const rosterOf = (client) => {
                const flat = client.memberIdentities();
                const lengths = client.memberIdentityLengths();
                const numbers = [];
                let offset = 0;
                for (const length of lengths) {
                    numbers.push(numberOf(flat.slice(offset, offset + length)));
                    offset += length;
                }
                return numbers.sort((left, right) => left - right);
            };
            const splitSnapshot = (client) => {
                const bytes = client.storageSnapshot();
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                const count = view.getUint32(0, false);
                const keyBytes = view.getUint32(4, false);
                const keyLengths = new Uint32Array(count);
                const blobLengths = new Uint32Array(count);
                for (let index = 0; index < count; index += 1) keyLengths[index] = view.getUint32(8 + index * 4, false);
                for (let index = 0; index < count; index += 1) {
                    blobLengths[index] = view.getUint32(8 + (count + index) * 4, false);
                }
                const blobs = 8 + count * 8;
                return {
                    identity: client.identity.slice(),
                    signingPublicKey: client.signingPublicKey.slice(),
                    groupId: client.groupId.slice(),
                    keys: bytes.slice(blobs, blobs + keyBytes),
                    keyLengths,
                    blobs: bytes.slice(blobs + keyBytes),
                    blobLengths,
                    bytes: bytes.byteLength,
                };
            };
            const restore = (parts) =>
                EphemonMlsClient.restore(
                    parts.identity,
                    parts.signingPublicKey,
                    parts.groupId,
                    parts.keys,
                    parts.keyLengths,
                    parts.blobs,
                    parts.blobLengths,
                );

            let alice = new EphemonMlsClient(identityOf(0));
            let bob = new EphemonMlsClient(identityOf(1));
            alice.createGroup(encoder.encode('ephemon-browser-test-group'));
            const keyPackage = bob.createKeyPackage();
            const add = alice.stageAddMember(keyPackage);
            const commit = add.commit;
            const welcome = add.welcome;
            const claimed = numberOf(add.claimedIdentity);
            add.free();
            if (claimed !== 1) throw new Error(`Key package claimed member ${claimed} rather than 1`);
            alice.mergePendingCommit();
            bob.joinFromWelcome(welcome);

            const aliceRoster = rosterOf(alice);
            const bobRoster = rosterOf(bob);
            if (alice.epoch() !== 1n || bob.epoch() !== 1n) throw new Error('MLS epoch did not advance to 1');
            if (aliceRoster.join(',') !== '0,1' || bobRoster.join(',') !== '0,1') {
                throw new Error(`Unexpected MLS rosters: Alice=${aliceRoster}; Bob=${bobRoster}`);
            }

            const firstPlaintext = encoder.encode('real OpenMLS message before restart');
            const firstMessage = alice.createApplicationMessage(firstPlaintext);
            const serializedFirstMessage = Array.from(firstMessage);
            const processedFirst = bob.processApplicationMessage(firstMessage);
            if (
                !processedFirst.senderIsMember ||
                numberOf(processedFirst.senderIdentity) !== 0 ||
                decoder.decode(processedFirst.payload) !== decoder.decode(firstPlaintext)
            ) {
                throw new Error('Bob did not authenticate and decrypt Alice as member 0');
            }
            processedFirst.free();

            const aliceParts = splitSnapshot(alice);
            const bobParts = splitSnapshot(bob);
            const metrics = {
                keyPackageBytes: keyPackage.byteLength,
                commitBytes: commit.byteLength,
                welcomeBytes: welcome.byteLength,
                applicationMessageBytes: firstMessage.byteLength,
                aliceSnapshotBytes: aliceParts.bytes,
                bobSnapshotBytes: bobParts.bytes,
            };
            alice.free();
            bob.free();

            alice = restore(aliceParts);
            bob = restore(bobParts);
            const secondPlaintext = encoder.encode('real OpenMLS message after restart');
            const secondMessage = bob.createApplicationMessage(secondPlaintext);
            const processedSecond = alice.processApplicationMessage(secondMessage);
            if (
                !processedSecond.senderIsMember ||
                numberOf(processedSecond.senderIdentity) !== 1 ||
                decoder.decode(processedSecond.payload) !== decoder.decode(secondPlaintext)
            ) {
                throw new Error('Alice did not authenticate and decrypt restored Bob as member 1');
            }
            processedSecond.free();
            alice.free();
            bob.free();

            const plaintextText = decoder.decode(firstPlaintext);
            const serializedText = String.fromCharCode(...serializedFirstMessage);
            if (serializedText.includes(plaintextText))
                throw new Error('Plaintext is visible in the MLS application message');

            const workerResult = await (async () => {
                const protocolVersion = 1;
                const checkpoints = new Map();
                const revisions = new Map();
                let worker;
                let requestId = 1;
                let pending = new Map();

                const startWorker = () => {
                    worker = new Worker('/mls.worker.js', { name: 'ephemon-mls-browser-test' });
                    pending = new Map();
                    worker.onmessage = ({ data }) => {
                        const entry = pending.get(data.requestId);
                        if (!entry) return;
                        pending.delete(data.requestId);
                        if (data.ok) entry.resolve(data);
                        else entry.reject(new Error(data.error));
                    };
                    worker.onerror = (event) => {
                        for (const entry of pending.values())
                            entry.reject(new Error(event.message || 'worker crashed'));
                        pending.clear();
                    };
                };
                const rpc = (payload) => {
                    const id = requestId++;
                    return new Promise((resolve, reject) => {
                        pending.set(id, { resolve, reject });
                        worker.postMessage({ protocolVersion, requestId: id, ...payload });
                    });
                };
                const rosterFromInspection = (inspection) => {
                    const flat = inspection.memberIdentities ?? new Uint8Array();
                    const lengths = inspection.memberIdentityLengths ?? new Uint32Array();
                    const numbers = [];
                    let offset = 0;
                    for (const length of lengths) {
                        numbers.push(numberOf(Uint8Array.from(flat).slice(offset, offset + length)));
                        offset += length;
                    }
                    return numbers.sort((left, right) => left - right);
                };
                const load = (conversationId, memberNumber) =>
                    rpc({
                        kind: 'load',
                        conversationId,
                        identity: identityOf(memberNumber),
                        checkpoint: checkpoints.get(conversationId),
                    });
                const mutate = async (conversationId, command) => {
                    const response = await rpc({ kind: 'execute', conversationId, command });
                    if (response.kind !== 'executed') throw new Error(`Unexpected worker response ${response.kind}`);
                    checkpoints.set(conversationId, Uint8Array.from(response.checkpoint));
                    revisions.set(conversationId, (revisions.get(conversationId) || 0) + 1);
                    const accepted = await rpc({
                        kind: 'accept',
                        conversationId,
                        operationId: response.operationId,
                    });
                    if (accepted.kind !== 'accepted') throw new Error('Worker did not accept persisted checkpoint');
                    return response.result;
                };

                const aliceConversation = 100;
                const bobConversation = 101;
                const rollbackConversation = 102;
                const recoveryConversation = 103;
                startWorker();
                await load(aliceConversation, 0);
                await load(bobConversation, 1);
                await mutate(aliceConversation, {
                    kind: 'createGroup',
                    groupId: encoder.encode('ephemon-worker-test-group'),
                });
                const keyPackageResult = await mutate(bobConversation, { kind: 'createKeyPackage' });
                const addResult = await mutate(aliceConversation, {
                    kind: 'stageAddMember',
                    keyPackage: keyPackageResult.keyPackage,
                });
                await mutate(aliceConversation, { kind: 'mergePendingCommit' });
                await mutate(bobConversation, { kind: 'joinFromWelcome', welcome: addResult.welcome });

                const beforeRestartPlaintext = encoder.encode('worker message before restart');
                const beforeRestartMessage = await mutate(aliceConversation, {
                    kind: 'createApplicationMessage',
                    payload: beforeRestartPlaintext,
                });
                const beforeRestartProcessed = await mutate(bobConversation, {
                    kind: 'processApplicationMessage',
                    message: beforeRestartMessage.message,
                });
                if (
                    numberOf(beforeRestartProcessed.senderIdentity) !== 0 ||
                    decoder.decode(beforeRestartProcessed.payload) !== decoder.decode(beforeRestartPlaintext)
                ) {
                    throw new Error('Worker did not authenticate Alice before restart');
                }

                await load(rollbackConversation, 7);
                const rolledBack = await rpc({
                    kind: 'execute',
                    conversationId: rollbackConversation,
                    command: { kind: 'createGroup', groupId: encoder.encode('must-not-survive') },
                });
                await rpc({
                    kind: 'rollback',
                    conversationId: rollbackConversation,
                    operationId: rolledBack.operationId,
                });
                const rollbackInspection = await rpc({ kind: 'inspect', conversationId: rollbackConversation });
                if (rollbackInspection.epoch !== undefined) throw new Error('Rolled-back MLS group survived');

                await load(recoveryConversation, 8);
                const recoverable = await rpc({
                    kind: 'execute',
                    conversationId: recoveryConversation,
                    command: { kind: 'createGroup', groupId: encoder.encode('recoverable-group') },
                });
                await rpc({
                    kind: 'load',
                    conversationId: recoveryConversation,
                    identity: identityOf(8),
                    checkpoint: recoverable.checkpoint,
                });
                const recoveryInspection = await rpc({ kind: 'inspect', conversationId: recoveryConversation });
                if (recoveryInspection.epoch !== '0') {
                    throw new Error('Persisted pending MLS state was not recoverable by authoritative reload');
                }

                let invalidReloadRejected = false;
                try {
                    await rpc({
                        kind: 'load',
                        conversationId: aliceConversation,
                        identity: identityOf(0),
                        checkpoint: Uint8Array.from([1, 2, 3]),
                    });
                } catch {
                    invalidReloadRejected = true;
                }
                if (!invalidReloadRejected) throw new Error('Malformed MLS checkpoint reload was accepted');
                const afterInvalidReload = await rpc({ kind: 'inspect', conversationId: aliceConversation });
                if (afterInvalidReload.epoch !== '1') {
                    throw new Error('Malformed checkpoint reload destroyed the active MLS session');
                }

                const beforeRestartInspection = await rpc({ kind: 'inspect', conversationId: aliceConversation });
                if (
                    beforeRestartInspection.epoch !== '1' ||
                    rosterFromInspection(beforeRestartInspection).join(',') !== '0,1'
                ) {
                    throw new Error('Unexpected worker MLS state before restart');
                }

                worker.terminate();
                startWorker();
                await load(aliceConversation, 0);
                await load(bobConversation, 1);

                const afterRestartPlaintext = encoder.encode('worker message after restart');
                const afterRestartMessage = await mutate(bobConversation, {
                    kind: 'createApplicationMessage',
                    payload: afterRestartPlaintext,
                });
                const afterRestartProcessed = await mutate(aliceConversation, {
                    kind: 'processApplicationMessage',
                    message: afterRestartMessage.message,
                });
                if (
                    numberOf(afterRestartProcessed.senderIdentity) !== 1 ||
                    decoder.decode(afterRestartProcessed.payload) !== decoder.decode(afterRestartPlaintext)
                ) {
                    throw new Error('Worker did not authenticate Bob after restart');
                }
                const afterRestartInspection = await rpc({ kind: 'inspect', conversationId: bobConversation });
                worker.terminate();
                return {
                    epoch: afterRestartInspection.epoch,
                    roster: rosterFromInspection(afterRestartInspection),
                    revisions: Object.fromEntries(revisions),
                    checkpointBytes: Object.fromEntries(
                        [...checkpoints].map(([conversationId, checkpoint]) => [conversationId, checkpoint.byteLength]),
                    ),
                };
            })();

            return { actualAbiVersion, metrics, workerResult };
        },
        { expectedAbiVersion },
    );

    console.log(`MLS WASM ABI ${result.actualAbiVersion} completed a two-member restart flow in Chromium.`);
    console.log(`MLS artifact sizes: ${JSON.stringify(result.metrics)}`);
    console.log(`MLS worker restart flow: ${JSON.stringify(result.workerResult)}`);
    console.log(`MLS encrypted checkpoint store: ${JSON.stringify(storageResult)}`);
    console.log(`MLS typed worker client: ${JSON.stringify(clientResult)}`);
} finally {
    await browser.close();
    await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
}
