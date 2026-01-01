import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      '**/__tests__/**/*.test.{ts,tsx,js}',
      '**/__tests__/*.test.{ts,tsx,js}',
      '**/*.test.{ts,tsx,js}'
    ],
    isolate: true,
  },
});
