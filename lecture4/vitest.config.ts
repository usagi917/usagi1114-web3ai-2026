import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // integration テストは temp git repo / 実 rg を呼ぶため少し余裕を持たせる
    testTimeout: 15000,
  },
});
