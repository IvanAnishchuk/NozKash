import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['**/*.test.ts'],
        exclude: ['**/*.e2e.test.ts', '**/node_modules/**'],
        coverage: {
            provider: 'v8',
            include: ['bls12-381-crypto.ts', 'nozk-library.ts', 'mint-mock.ts', 'redeem-mock.ts'],
            reporter: ['text', 'text-summary'],
            thresholds: {
                statements: 90,
                branches: 70,
                functions: 90,
                lines: 90,
            },
        },
    },
});
