/* Sound: one mute toggle on every page, remembered between visits, and nothing plays before the first tap.
   These tests need no Firebase. They count what the page asks the browser's audio system to do. */
const { test, expect } = require("@playwright/test");

/* Counts AudioContexts, oscillators and spoken lines, so a test can tell "nothing was scheduled" from "a sound was". */
async function countAudio(context) {
  await context.addInitScript(() => {
    window.__ac = 0; window.__osc = 0; window.__spk = 0;
    ["AudioContext", "webkitAudioContext"].forEach((k) => {
      const A = window[k];
      if (!A) return;
      window[k] = class extends A {
        constructor(...a) { super(...a); window.__ac++; }
        createOscillator() { window.__osc++; return super.createOscillator(); }
      };
    });
    if (window.speechSynthesis) {
      const speak = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (u) => { window.__spk++; return speak(u); };
    }
    try { localStorage.setItem("tp_age_ok", "yes"); } catch (e) {}
  });
}
const audio = (page) => page.evaluate(() => ({ ac: window.__ac, osc: window.__osc, spk: window.__spk }));

const PAGES = [
  "/index.html",
  "/games/index.html",
  "/blog/index.html",
  "/settings.html",
  "/play/party.html",
  "/play/card-lottery.html",
  "/games/never-have-i-ever.html",
  "/games/kings-cup.html",
  "/games/split-decision.html"
];

test("mute toggle is on every page, 44px, and remembers the choice between visits", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true });
  await countAudio(context);
  const page = await context.newPage();
  await page.route(/googletagmanager|google-analytics|analytics\.google/, (r) => r.abort());
  for (const url of PAGES) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const mute = page.locator("#mute");
    await expect(mute, url).toBeVisible();
    const box = await mute.boundingBox();
    expect(box.height, url + " mute height").toBeGreaterThanOrEqual(44);
    expect(box.width, url + " mute width").toBeGreaterThanOrEqual(44);
    expect(box.x + box.width, url + " inside the screen").toBeLessThanOrEqual(391);
    await expect(mute).toHaveAttribute("aria-pressed", "false");
  }
  // one flag for the whole site: muting on one page is remembered on the next
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.locator("#mute").click();
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#mute")).toHaveText("🔇");
  expect(await page.evaluate(() => localStorage.getItem("tp_sound"))).toBe("off");
  for (const url of ["/games/kings-cup.html", "/play/card-lottery.html", "/settings.html"]) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#mute"), url + " stays muted").toHaveAttribute("aria-pressed", "true");
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
  // and unmuting is remembered too
  await page.locator("#mute").click();
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => localStorage.getItem("tp_sound"))).toBe("on");
  await context.close();
});

test("muted means silent for both sound engines, and unmuting brings them back", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true });
  await countAudio(context);
  const page = await context.newPage();
  await page.route(/googletagmanager|google-analytics|analytics\.google/, (r) => r.abort());
  await page.goto("/games/kings-cup.html", { waitUntil: "domcontentloaded" });
  await page.locator("#mute").waitFor();
  // mute first (this tap also counts as the first tap)
  await page.locator("#mute").click();
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
  const before = await audio(page);
  await page.evaluate(() => {
    TPSound.click(); TPSound.yes(); TPSound.no(); TPSound.card(); TPSound.celebrate();
    const e = PartyAudio.create({}); ["flip", "clink", "sting", "payoff", "tick"].forEach((c) => e.cue(c));
  });
  await page.waitForTimeout(300);
  const muted = await audio(page);
  expect(muted.osc, "no oscillator may start while muted").toBe(before.osc);
  // unmute: both engines make sound again
  await page.locator("#mute").click();
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "false");
  const mid = await audio(page);
  await page.evaluate(() => { TPSound.yes(); });
  await page.waitForTimeout(150);
  const afterBlip = await audio(page);
  expect(afterBlip.osc, "UI sound plays when unmuted").toBeGreaterThan(mid.osc);
  await page.evaluate(() => { window.__pe = window.__pe || PartyAudio.create({}); window.__pe.cue("flip"); });
  await page.waitForTimeout(150);
  const afterCue = await audio(page);
  expect(afterCue.osc, "party effect plays when unmuted").toBeGreaterThan(afterBlip.osc);
  // flipping the switch while the party engine exists takes effect straight away
  await page.locator("#mute").click();
  const m2 = await audio(page);
  await page.evaluate(() => { window.__pe.cue("clink"); window.__pe.cue("payoff"); });
  await page.waitForTimeout(200);
  expect((await audio(page)).osc, "muting again silences the party engine").toBe(m2.osc);
  await context.close();
});

test("nothing plays before the first tap, and only after it", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true });
  await countAudio(context);
  const page = await context.newPage();
  await page.route(/googletagmanager|google-analytics|analytics\.google/, (r) => r.abort());
  for (const url of ["/games/kings-cup.html", "/games/never-have-i-ever.html", "/play/card-lottery.html", "/games/whos-most-likely.html", "/games/split-decision.html"]) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator("#mute").waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    expect(await audio(page), url + " is silent on load").toEqual({ ac: 0, osc: 0, spk: 0 });
  }
  // game events can fire before the player has touched the page. They must be dropped, not queued.
  await page.goto("/games/kings-cup.html", { waitUntil: "domcontentloaded" });
  await page.locator("#mute").waitFor({ state: "visible" });
  await page.evaluate(() => {
    TPSound.yes(); TPSound.card(); TPSound.celebrate();
    const e = PartyAudio.create({}); e.cue("flip"); e.cue("sting"); e.cue("payoff"); e.unlock();
  });
  await page.waitForTimeout(400);
  expect(await audio(page), "events before a tap create no audio context and schedule nothing").toEqual({ ac: 0, osc: 0, spk: 0 });
  // the first real tap unlocks sound
  await page.mouse.click(8, 300);
  expect(await page.evaluate(() => TPSound.tapped())).toBe(true);
  await page.evaluate(() => { TPSound.yes(); });
  await page.waitForTimeout(200);
  const afterTap = await audio(page);
  expect(afterTap.ac, "an audio context exists only after the tap").toBeGreaterThanOrEqual(1);
  expect(afterTap.osc, "and the sound is played").toBeGreaterThan(0);
  await page.evaluate(() => { window.__pe = PartyAudio.create({}); window.__pe.cue("flip"); });
  await page.waitForTimeout(200);
  expect((await audio(page)).osc, "party effects play after the tap").toBeGreaterThan(afterTap.osc);
  await context.close();
});

test("no background music, no spoken announcer, nothing scheduled while idle", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true });
  await countAudio(context);
  const page = await context.newPage();
  await page.route(/googletagmanager|google-analytics|analytics\.google/, (r) => r.abort());
  await page.goto("/games/kings-cup.html", { waitUntil: "domcontentloaded" });
  await page.locator("#mute").waitFor({ state: "visible" });
  await page.mouse.click(8, 300); // unlock sound
  const e = await page.evaluate(() => { window.__pe = PartyAudio.create({ host: () => true }); return Object.keys(window.__pe).sort(); });
  // the old music and voice entry points still exist so the games' calls do not break, but they do nothing
  await page.evaluate(() => { window.__pe.startMusic(); window.__pe.say("King's Cup!"); window.__pe.say("Final King!"); });
  const base = await audio(page);
  await page.waitForTimeout(3000);
  const idle = await audio(page);
  expect(idle.osc - base.osc, "a music loop would schedule dozens of oscillators in three seconds").toBe(0);
  expect(idle.spk, "no speech").toBe(0);
  expect(e).toContain("cue");
  // the Mixer, whose only jobs were music and voice, is gone from the game pages
  for (const url of ["/games/kings-cup.html", "/games/never-have-i-ever.html", "/games/whos-most-likely.html"]) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#mixbtn, #mixer, #mutemusic, #mutevoice"), url + " has no mixer").toHaveCount(0);
  }
  await context.close();
});
