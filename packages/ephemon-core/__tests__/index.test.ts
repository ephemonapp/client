import * as ephemonModule from '../src/ephemon';
import { Connection, ConnectionState, getPrototype, Ephemon, EphemonPrototype } from '../src/index';

vi.mock('../src/services/connection/connection', () => ({
    ConnectionState: {
        New: 'new',
        Connecting: 'connecting',
        Open: 'open',
        Closed: 'closed',
    },
    Connection: vi.fn(),
}));

vi.mock('../src/ephemon', () => ({
    getPrototype: vi.fn(),
    EphemonPrototype: {},
    Ephemon: {},
}));

describe('index', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should export getPrototype function', () => {
        expect(getPrototype).toBe(ephemonModule.getPrototype);
    });

    it('should export Ephemon type', () => {
        const ephemon: Ephemon = {
            get publicKey(): string | undefined {
                return undefined;
            },
            get serverTime(): number {
                return 0;
            },
            get connections(): Connection[] {
                return [];
            },
            get(publicKeyBase64: string): Connection {
                return {} as Connection;
            },
            delete(publicKeyBase64: string): void {},
            showNotification(title: string, options?: NotificationOptions): boolean {
                return true;
            },
        };
        expect(ephemon).toBeDefined();
    });

    it('should export EphemonPrototype type', () => {
        const prototype: EphemonPrototype = {
            initialize: async (config: any) => ({}) as Ephemon,
            generateSigningKeyPair: () => ({}) as any,
        };
        expect(prototype).toBeDefined();
    });

    it('should export Connection type', () => {
        const connection: Connection = {
            get publicKey(): string {
                return '';
            },
            get state(): ConnectionState {
                return ConnectionState.New;
            },
            open: async () => ({}) as any,
            send: (message: Uint8Array) => {},
            close: () => {},
            get onProgress(): ((progress: number) => void) | undefined {
                return undefined;
            },
            set onProgress(onProgress: ((progress: number) => void) | undefined) {},
            get onStateChanged(): ((from: ConnectionState, to: ConnectionState) => void) | undefined {
                return undefined;
            },
            set onStateChanged(onStateChange: ((from: ConnectionState, to: ConnectionState) => void) | undefined) {},
            get onMessage(): ((message: Uint8Array) => void) | undefined {
                return undefined;
            },
            set onMessage(onMessage: ((message: Uint8Array) => void) | undefined) {},
        };
        expect(connection).toBeDefined();
    });

    it('should export ConnectionState enum', () => {
        expect(ConnectionState).toBeDefined();
        expect(ConnectionState.New).toBe('new');
        expect(ConnectionState.Connecting).toBe('connecting');
        expect(ConnectionState.Open).toBe('open');
        expect(ConnectionState.Closed).toBe('closed');
    });
});
