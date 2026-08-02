import { defineConfig } from '@playwright/test';

export const AUDIT_HOST = 'audit.ephemon.test';
export const AUDIT_PORT = 8443;
export const AUDIT_ORIGIN = `https://${AUDIT_HOST}:${AUDIT_PORT}`;

const SERVER_URL = process.env.EPHEMON_SERVER_URL ?? 'https://s.ephemon.app';
const VAPID_KEY =
    process.env.EPHEMON_VAPID_KEY ??
    'BHAYDRAjMWXfg7dxFIOZYNLlxrVDohy_PbN7SXcrXapiZq0Jnt0VXsAx6ytkLArVVFDSfula4VRWm5HDvkVVRbA';

export default defineConfig({
    testDir: './tests',
    timeout: 3 * 60_000,
    expect: { timeout: 30_000 },
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
    use: {
        baseURL: AUDIT_ORIGIN,
        ignoreHTTPSErrors: true,
        trace: 'retain-on-failure',
        launchOptions: {
            args: [`--host-resolver-rules=MAP ${AUDIT_HOST} 127.0.0.1`, '--ignore-certificate-errors'],
        },
    },
    webServer: {
        command: `npm run prerender && npx webpack serve --env environment=local --server-type https --port ${AUDIT_PORT}`,
        url: `https://localhost:${AUDIT_PORT}/`,
        ignoreHTTPSErrors: true,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
            EPHEMON_SERVER_URL: SERVER_URL,
            EPHEMON_CLIENT_URL: AUDIT_ORIGIN,
            EPHEMON_VAPID_KEY: VAPID_KEY,
        },
    },
});
