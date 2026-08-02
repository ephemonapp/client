import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['**/__tests__/**/*.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{js,ts}'],
            exclude: ['src/**/*.d.ts', '**/node_modules/**', '**/dist/**'],
            reporter: ['text', 'clover', 'lcov', 'html', 'json-summary'],
            thresholds: {
                branches: 100,
                functions: 100,
                lines: 100,
                statements: 100,
            },
        },
    },
});
