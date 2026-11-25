const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  globalSetup: require.resolve("./guard-setup.js"),
  globalTeardown: require.resolve("./guard-teardown.js"),
  testDir: ".",
  testMatch: ["browser.spec.js", "audio.spec.js", "room-ui.spec.js", "theme.spec.js", "vault.spec.js", "drip.spec.js", "split-end.spec.js", "split-six.spec.js", "split-fx.spec.js", "kings-cup-screens.spec.js", "quiplash.spec.js", "mole.spec.js", "frenzy.spec.js", "frenzy-fx.spec.js", "frenzy-modes.spec.js", "court.spec.js", "countdown.spec.js"],
  timeout: 240000,
  expect: { timeout: 20000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", grep: /age gate|narrow pages|mute toggle|first tap/, use: { browserName: "webkit" } }
  ],
  use: {
    baseURL: process.env.TIPSY_BASE || "http://127.0.0.1:8765",
    serviceWorkers: "block",
    viewport: { width: 390, height: 844 }
  }
});
