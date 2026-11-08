const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: ".",
  testMatch: "browser.spec.js",
  timeout: 240000,
  expect: { timeout: 20000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", grep: /age gate|narrow pages/, use: { browserName: "webkit" } }
  ],
  use: {
    baseURL: process.env.TIPSY_BASE || "http://127.0.0.1:8765",
    serviceWorkers: "block",
    viewport: { width: 390, height: 844 }
  }
});
