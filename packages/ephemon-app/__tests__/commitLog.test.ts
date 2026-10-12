import {
    COMMIT_AUTHENTICATOR_BYTES,
    CommitHead,
    commitsAfter,
    decodeCommitHead,
    encodeCommitHead,
    relateHeads,
} from '../src/mls/commitLog';
import { StoredMlsCommit } from '../src/utils/database';

function head(epoch: number, fill = 1): CommitHead {
    return { epoch: BigInt(epoch), authenticator: new Uint8Array(COMMIT_AUTHENTICATOR_BYTES).fill(fill) };
}

function commit(epoch: number): StoredMlsCommit {
    return {
        epoch: String(epoch),
        authenticator: new Uint8Array(COMMIT_AUTHENTICATOR_BYTES).fill(epoch),
        commit: Uint8Array.of(epoch),
    };
}

describe('relateHeads', () => {
    it('calls the same epoch with the same authenticator equal', () => {
        expect(relateHeads(head(4), head(4))).toBe('equal');
    });

    it('calls the same epoch with a different authenticator a fork rather than trusting the epoch', () => {
        expect(relateHeads(head(4, 1), head(4, 2))).toBe('fork');
    });

    it('reads a higher epoch as ahead and a lower one as behind', () => {
        expect(relateHeads(head(5), head(4))).toBe('ahead');
        expect(relateHeads(head(3), head(4))).toBe('behind');
    });
});

describe('commitsAfter', () => {
    it('returns the commits above an epoch in the order they were written', () => {
        const after = commitsAfter([commit(3), commit(1), commit(2)], 1n);

        expect(after.map((entry) => entry.epoch)).toEqual(['2', '3']);
    });

    it('returns the whole log for a member that holds nothing', () => {
        expect(commitsAfter([commit(1), commit(2)], -1n).map((entry) => entry.epoch)).toEqual(['1', '2']);
    });

    it('returns nothing when the asking side is level', () => {
        expect(commitsAfter([commit(1), commit(2)], 2n)).toEqual([]);
    });
});

describe('the commit head wire format', () => {
    it('survives a round trip', () => {
        const decoded = decodeCommitHead(encodeCommitHead(head(9, 7)));

        expect(decoded.epoch).toBe(9n);
        expect(decoded.authenticator).toEqual(new Uint8Array(COMMIT_AUTHENTICATOR_BYTES).fill(7));
    });

    it('refuses an authenticator that is not the fixed width', () => {
        expect(() => encodeCommitHead({ epoch: 1n, authenticator: Uint8Array.of(1, 2) })).toThrow();
    });
});
