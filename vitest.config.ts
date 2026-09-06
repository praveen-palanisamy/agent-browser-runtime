import { defineConfig } from 'vitest/config';

// Two suites:
//   unit    — pure Node, no browser, sub-second (default `npm test`)
//   browser — real Chromium smoke tests (`npm run test:browser`), auto-skipped
//             when Playwright's Chromium is not installed.
const browser = process.env.ABR_TEST_SUITE === 'browser';

export default defineConfig({
  test: {
    include: browser
      ? ['__tests__/browser/**/*.browser.test.ts']
      : ['__tests__/**/*.test.ts'],
    exclude: browser
      ? ['node_modules/**']
      : ['node_modules/**', '__tests__/browser/**'],
    testTimeout: browser ? 60_000 : 10_000,
    hookTimeout: 30_000,
  },
});
