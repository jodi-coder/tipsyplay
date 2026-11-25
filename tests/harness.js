/* Shared Playwright fixture. Every browser context created by a test:
   - adds ?emulator=1 before the page's own scripts run, so sign-in uses the local emulators
   - blocks production Firebase and Google analytics, and fails the test if production Firebase is attempted
   Specs must `require("./harness")` instead of `@playwright/test` for this to apply. */
const fs = require("fs");
const { test: base, expect } = require("@playwright/test");
const { STATS } = require("./guard-stats");

/* Hostname only. The auth emulator URL is http://127.0.0.1:9099/identitytoolkit.googleapis.com/...
   and must not match: that path contains the production host name, but the request stays on localhost. */
const FIREBASE_URL = /https?:\/\/(?:[a-z0-9.-]+\.)?(?:firebaseio\.com|firebasedatabase\.app|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseinstallations\.googleapis\.com)(?::\d+)?(?:\/|$)/i;
const ANALYTICS_URL = /https?:\/\/(?:[a-z0-9.-]+\.)?(?:googletagmanager\.com|google-analytics\.com|analytics\.google\.com)(?::\d+)?(?:\/|$)/i;

const seen = new Set();
let current = null;

function blockedKind(url) {
  let host = "";
  try { host = new URL(url).hostname; } catch (e) { return null; }
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") return null;
  if (/(^|\.)firebaseio\.com$/i.test(host) || /(^|\.)firebasedatabase\.app$/i.test(host)) return "firebase";
  if (host === "identitytoolkit.googleapis.com" || host === "securetoken.googleapis.com") return "firebase";
  if (/(^|\.)firebaseinstallations\.googleapis\.com$/i.test(host) || /firebaseinstallations/i.test(host)) return "firebase";
  if (/(^|\.)googletagmanager\.com$/i.test(host) || /(^|\.)google-analytics\.com$/i.test(host) || /(^|\.)analytics\.google\.com$/i.test(host)) return "analytics";
  return null;
}

/* One line per blocked request. Appending keeps the log if Playwright starts a new worker
   after a timeout. A repeated line from that restart is dropped when the summary is written. */
function remember(kind, url, title, bucket) {
  const key = kind + "\n" + (title || "") + "\n" + url;
  if (seen.has(key)) return;
  seen.add(key);
  if (kind === "firebase" && bucket) bucket.hits.push({ url, title: title || "" });
  fs.appendFileSync(STATS, JSON.stringify({ kind, url, title: title || "" }) + "\n");
}

/* Runs before any page script. Game code reads location.search for emulator=1, so the flag has to be
   on the URL by then. replaceState does that without a second load. */
const EMULATOR_FLAG = `(() => {
  try {
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    if (location.hostname !== "127.0.0.1" && location.hostname !== "localhost") return;
    if (/[?&]emulator=1(?:&|$)/.test(location.search)) return;
    var join = location.search ? "&" : "?";
    history.replaceState(history.state, "", location.pathname + location.search + join + "emulator=1" + location.hash);
  } catch (e) {}
})();`;

/* Analytics handlers that a test registered must still run, because a few tests count the blocked
   tag request. Those handlers sit in front of a single abort registered first. Each later install
   puts a fall-through in front of them. Firebase is taken by a newer handler than the test's, so a
   test route cannot let a live host through. */
function guardHandlers(title, bucket) {
  return {
    abortAnalytics(route) {
      remember("analytics", route.request().url(), title, bucket);
      return route.abort("blockedbyclient");
    },
    passAnalytics(route) {
      return route.fallback();
    },
    takeFirebase(route) {
      const url = route.request().url();
      if (blockedKind(url) !== "firebase") return route.fallback();
      remember("firebase", url, title, bucket);
      return route.abort("blockedbyclient");
    }
  };
}
async function installFront(routeFn, handlers) {
  await routeFn(FIREBASE_URL, handlers.takeFirebase);
  await routeFn(ANALYTICS_URL, handlers.passAnalytics);
}

const armed = new WeakSet();

async function arm(context, testInfo) {
  if (armed.has(context)) return;
  armed.add(context);
  const title = testInfo.title;
  const bucket = current;
  const handlers = guardHandlers(title, bucket);
  await context.addInitScript({ content: EMULATOR_FLAG });
  context.on("request", (req) => {
    const kind = blockedKind(req.url());
    if (kind) remember(kind, req.url(), title, bucket);
  });
  const origRoute = context.route.bind(context);
  await origRoute(ANALYTICS_URL, handlers.abortAnalytics);
  await installFront(origRoute, handlers);
  context.route = async (url, handler, options) => {
    const out = await origRoute(url, handler, options);
    await installFront(origRoute, handlers);
    return out;
  };
  context.on("page", (page) => {
    const origPageRoute = page.route.bind(page);
    page.route = async (url, handler, options) => {
      const out = await origPageRoute(url, handler, options);
      await installFront(origPageRoute, handlers);
      return out;
    };
    installFront(origPageRoute, handlers).catch(() => {});
  });
}

const test = base.extend({
  _prodGuard: [async ({ browser }, use, testInfo) => {
    const mine = { hits: [] };
    const prev = current;
    current = mine;
    const origNewContext = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const context = await origNewContext(options);
      await arm(context, testInfo);
      return context;
    };
    await use();
    browser.newContext = origNewContext;
    current = prev;
    if (mine.hits.length) {
      const lines = mine.hits.map((hit) => hit.url);
      throw new Error(
        "Production Firebase was blocked.\n" +
        "A page tried to reach a live Firebase host. The request was stopped, and this test fails so it cannot be missed.\n" +
        lines.join("\n")
      );
    }
  }, { auto: true }],

  context: async ({ context, _prodGuard }, use, testInfo) => {
    void _prodGuard;
    await arm(context, testInfo);
    await use(context);
  }
});

module.exports = { test, expect };
