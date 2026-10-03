import { defineConfig } from 'vitest/config';

// The BLE tests use node:test (run by `npm run test:ble`); vitest owns src/features, src/core/coaching and src/integrations/backend; location, imu, replay and bluetooth use node:test.
export default defineConfig({ test: { include: ['src/features/**/*.test.ts', 'src/core/coaching/**/*.test.ts', 'src/core/events/**/*.test.ts', 'src/integrations/backend/**/*.test.ts', 'src/integrations/audio/**/*.test.ts', 'src/features/driving-session/**/*.test.ts'] } });
