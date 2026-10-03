import { defineConfig } from 'vitest/config';

// The BLE tests use node:test (run by `npm run test:ble`); vitest owns src/features and src/core/coaching; the rest use node:test.
export default defineConfig({ test: { include: ['src/features/**/*.test.ts', 'src/core/coaching/**/*.test.ts'] } });
