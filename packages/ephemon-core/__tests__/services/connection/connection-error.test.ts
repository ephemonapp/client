import { createMockLogger } from '../../../__mocks__/test-utils';
import { classifyCallError } from '../../../src/services/connection/connection-error';
import { newCallError } from '../../../src/utils/call-error';

const SERVER_URL = 'http://127.0.0.1:5028';

describe('classifyCallError', () => {
    let mockLogger: ReturnType<typeof createMockLogger>;

    beforeEach(() => {
        mockLogger = createMockLogger();
    });

    it('reads the server saying it has no route to the peer', () => {
        const error = newCallError(
            mockLogger as any,
            'refused',
            SERVER_URL,
            'Account h3jlkWMzm7dPyOlVuLZEHFy1TOqJ50lW4a0XD+vvg6c= is not reachable.',
        );

        expect(classifyCallError(error)).toEqual({ issue: 'peer-unreachable', serverUrl: SERVER_URL });
    });

    it('reads any other refusal as the server rejecting the call', () => {
        const error = newCallError(mockLogger as any, 'refused', SERVER_URL, 'Signature is not valid.');

        expect(classifyCallError(error)).toEqual({ issue: 'signalling-rejected', serverUrl: SERVER_URL });
    });

    it('reads a server that never answered as no signalling at all', () => {
        const error = newCallError(mockLogger as any, 'not reachable', SERVER_URL);

        expect(classifyCallError(error)).toEqual({ issue: 'signalling-unavailable', serverUrl: SERVER_URL });
    });

    it('keeps the server out of it when even that is unknown', () => {
        expect(classifyCallError(new Error('opaque'))).toEqual({ issue: 'signalling-unavailable' });
        expect(classifyCallError('a thrown string')).toEqual({ issue: 'signalling-unavailable' });
    });
});
