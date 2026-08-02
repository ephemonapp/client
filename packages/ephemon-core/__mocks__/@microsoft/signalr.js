const mockConnectionInstance = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    onreconnecting: vi.fn(),
    onreconnected: vi.fn(),
    on: vi.fn(),
    invoke: vi.fn(),
};

const mockConnectionBuilder = {
    withUrl: vi.fn().mockReturnThis(),
    withAutomaticReconnect: vi.fn().mockReturnThis(),
    configureLogging: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue(mockConnectionInstance),
};

module.exports = {
    HubConnection: vi.fn(),
    HubConnectionBuilder: vi.fn().mockImplementation(function () {
        return mockConnectionBuilder;
    }),
    LogLevel: {
        Warning: 'Warning',
    },
};
