import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    coverage: { include: ['packages/core/src/**', 'apps/extension/src/lib/**'] },
  },
});
