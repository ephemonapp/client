declare let __webpack_get_script_filename__: (chunkId: string | number) => string;

declare namespace App {
    type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
}

declare namespace NodeJS {
    interface ProcessEnv {
        EPHEMON_CONSOLE_LOG_LEVEL: App.LogLevel;
        EPHEMON_DOCUMENT_LOG_LEVEL: App.LogLevel;
        EPHEMON_BUILD_TIMESTAMP: string;
        EPHEMON_PRESET: 'built-in' | 'none';
        EPHEMON_SERVER_URL: string;
        EPHEMON_CLIENT_URL: string;
        EPHEMON_VAPID_KEY: string;
        EPHEMON_APP_NAME: string;
    }
}
