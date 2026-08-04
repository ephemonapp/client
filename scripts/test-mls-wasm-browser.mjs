import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import process from 'node:process';

const expectedAbiVersion = 2;
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
            let alice = new EphemonMlsClient(0);
            let bob = new EphemonMlsClient(1);
            alice.createGroup(encoder.encode('ephemon-browser-test-group'));
            const keyPackage = bob.createKeyPackage();
            const add = alice.stageAddMember(keyPackage);
            const commit = add.commit;
            const welcome = add.welcome;
            add.free();
            alice.mergePendingCommit();
            bob.joinFromWelcome(welcome);

            const aliceRoster = Array.from(alice.memberNumbers());
            const bobRoster = Array.from(bob.memberNumbers());
            if (alice.epoch() !== 1n || bob.epoch() !== 1n) throw new Error('MLS epoch did not advance to 1');
            if (aliceRoster.join(',') !== '0,1' || bobRoster.join(',') !== '0,1') {
                throw new Error(`Unexpected MLS rosters: Alice=${aliceRoster}; Bob=${bobRoster}`);
            }

            const firstPlaintext = encoder.encode('real OpenMLS message before restart');
            const firstMessage = alice.createApplicationMessage(firstPlaintext);
            const serializedFirstMessage = Array.from(firstMessage);
            const processedFirst = bob.processApplicationMessage(firstMessage);
            if (
                processedFirst.senderMemberNumber !== 0 ||
                decoder.decode(processedFirst.payload) !== decoder.decode(firstPlaintext)
            ) {
                throw new Error('Bob did not authenticate and decrypt Alice as MemberNumber 0');
            }
            processedFirst.free();

            const aliceCheckpoint = alice.exportCheckpoint();
            const bobCheckpoint = bob.exportCheckpoint();
            const metrics = {
                keyPackageBytes: keyPackage.byteLength,
                commitBytes: commit.byteLength,
                welcomeBytes: welcome.byteLength,
                applicationMessageBytes: firstMessage.byteLength,
                aliceCheckpointBytes: aliceCheckpoint.byteLength,
                bobCheckpointBytes: bobCheckpoint.byteLength,
            };
            alice.free();
            bob.free();

            alice = EphemonMlsClient.importCheckpoint(aliceCheckpoint);
            bob = EphemonMlsClient.importCheckpoint(bobCheckpoint);
            const secondPlaintext = encoder.encode('real OpenMLS message after restart');
            const secondMessage = bob.createApplicationMessage(secondPlaintext);
            const processedSecond = alice.processApplicationMessage(secondMessage);
            if (
                processedSecond.senderMemberNumber !== 1 ||
                decoder.decode(processedSecond.payload) !== decoder.decode(secondPlaintext)
            ) {
                throw new Error('Alice did not authenticate and decrypt restored Bob as MemberNumber 1');
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
                const load = (conversationId, memberNumber) =>
                    rpc({
                        kind: 'load',
                        conversationId,
                        memberNumber,
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
                    beforeRestartProcessed.senderMemberNumber !== 0 ||
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
                    memberNumber: 8,
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
                        memberNumber: 0,
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
                    Array.from(beforeRestartInspection.memberNumbers || []).join(',') !== '0,1'
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
                    afterRestartProcessed.senderMemberNumber !== 1 ||
                    decoder.decode(afterRestartProcessed.payload) !== decoder.decode(afterRestartPlaintext)
                ) {
                    throw new Error('Worker did not authenticate Bob after restart');
                }
                const afterRestartInspection = await rpc({ kind: 'inspect', conversationId: bobConversation });
                worker.terminate();
                return {
                    epoch: afterRestartInspection.epoch,
                    roster: Array.from(afterRestartInspection.memberNumbers || []),
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
