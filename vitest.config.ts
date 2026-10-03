import { defineConfig } from 'vitest/config';

// The BLE tests use node:test (run by `npm run test:ble`); vitest only owns src/features.
export default defineConfig({ test: { include: ['src/features/**/*.test.ts'] } });
