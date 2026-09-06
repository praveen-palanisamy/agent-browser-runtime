// Minimal WebPostStrategy module for `agent-browser-runtime serve --strategies`.
// It drives example.com so it works anywhere without credentials; real
// strategies implement the same three methods against a platform's UI.
//
//   AGENT_RUNNER_TOKEN=... npx agent-browser-runtime serve --strategies ./examples/demo-strategy/index.js

/** @type {import('@praveen-palanisamy/agent-browser-runtime').WebPostStrategy} */
const demoStrategy = {
  platform: 'demo',
  loginUrl: 'https://example.com/',

  validate(content) {
    if (!content.text || !content.text.trim()) return 'Text is required';
    if (content.text.length > 280) return 'Text exceeds 280 characters';
    return null;
  },

  async isAuthenticated(context) {
    // A real strategy checks for a logged-in marker (avatar, compose button…).
    const page = await context.newPage();
    try {
      await page.goto('https://example.com/', {
        waitUntil: 'domcontentloaded',
      });
      return (await page.title()).length > 0;
    } finally {
      await page.close();
    }
  },

  async post(context, content) {
    const page = await context.newPage();
    try {
      await page.goto('https://example.com/', {
        waitUntil: 'domcontentloaded',
      });
      // Verification is the strategy's job: read back what the UI shows and
      // only report ok when it matches `content`.
      const heading = await page.textContent('h1');
      return heading
        ? {
            ok: true,
            platformPostId: `demo-${Date.now()}`,
            verification: 'toast',
          }
        : { ok: false, failureStage: 'verify', error: 'no heading rendered' };
    } finally {
      await page.close();
    }
  },
};

module.exports = [demoStrategy];
