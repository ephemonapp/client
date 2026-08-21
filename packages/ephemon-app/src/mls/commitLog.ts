import { StoredMlsCommit } from '../utils/database';
import { Reader, Writer } from './byteCodec';

export const COMMIT_AUTHENTICATOR_BYTES = 32;

export type CommitHead = {
    epoch: bigint;
    authenticator: Uint8Array;
};

export type HeadRelation = 'equal' | 'ahead' | 'behind' | 'fork';

const HEAD_LABEL = 'MLS commit head';

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

export function sameHead(left: CommitHead, right: CommitHead): boolean {
    return left.epoch === right.epoch && sameBytes(left.authenticator, right.authenticator);
}

/** Equal epoch with a different authenticator is a fork; a higher remote epoch only means this side is behind. */
export function relateHeads(own: CommitHead, peer: CommitHead): HeadRelation {
    if (own.epoch === peer.epoch) return sameBytes(own.authenticator, peer.authenticator) ? 'equal' : 'fork';
    return own.epoch > peer.epoch ? 'ahead' : 'behind';
}

export function commitsAfter(commits: ReadonlyArray<StoredMlsCommit>, epoch: bigint): ReadonlyArray<StoredMlsCommit> {
    return commits
        .filter((commit) => BigInt(commit.epoch) > epoch)
        .sort((left, right) => (BigInt(left.epoch) < BigInt(right.epoch) ? -1 : 1));
}

export function encodeCommitHead(head: CommitHead): Uint8Array {
    const writer = new Writer();
    writer.u64(head.epoch);
    writer.fixed(head.authenticator, COMMIT_AUTHENTICATOR_BYTES, 'Commit authenticator');
    return writer.finish();
}

export function decodeCommitHead(bytes: Uint8Array): CommitHead {
    const reader = new Reader(bytes, HEAD_LABEL);
    const epoch = reader.u64();
    const authenticator = reader.fixed(COMMIT_AUTHENTICATOR_BYTES);
    reader.finish();
    return { epoch, authenticator };
}
