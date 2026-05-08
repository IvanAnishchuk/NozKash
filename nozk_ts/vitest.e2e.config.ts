import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['**/*.e2e.test.ts'],
        exclude: ['**/node_modules/**'],
        testTimeout: 60_000,
        hookTimeout: 30_000,
    },
});
