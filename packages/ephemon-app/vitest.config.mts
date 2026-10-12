import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@ephemon/core': fileURLToPath(new URL('../ephemon-core/src', import.meta.url)),
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['__tests__/**/*.test.ts?(x)'],
    },
});
