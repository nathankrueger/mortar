import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['shared/src/**/*.test.ts', 'server/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['shared/src/**/*.ts', 'server/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
    },
  },
});
