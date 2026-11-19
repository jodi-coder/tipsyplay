/* Five Letter Frenzy sound and motion, on the Firebase emulators and the local word keeper.
   The effects only decorate the screen: every tile must still end with the right mark class and symbol,
   with motion on and with prefers-reduced-motion, and no sound may play before the first tap or while muted. */
const { test, expect } = require("@playwright/test");
const BASE = process.env.TIPSY_BASE || "http://127.0.0.1:8765";
const PAGE = "/games/five-letter-frenzy.html?mode=table&emulator=1&fast=1&word=crane";
const PROMPT = "One small drink or a 5-second pose — or Pass.";
/* TRACE against CRANE: T not in the word, R A locked, C in the wrong place, E locked */
const TRACE = [["miss", "×"], ["lock", "●"], ["lock", "●"], ["move", "↗"], ["lock", "●"]];

async function phone(browser, name, reducedMotion) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: "block", reducedMotion });
  await context.route(/googletagmanager|google-analytics/, (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push((e && e.stack) || String(e)));
  await page.addInitScript((n) => {
    localStorage.setItem("tp_age_ok", "yes");
    localStorage.setItem("tp_sound", "off");
    localStorage.setItem("tp_name", n);
  }, name);
  await page.goto(BASE + PAGE);
  await page.locator("#hostbtn").waitFor({ state: "visible" });
  return { context, page, name, errors };
}
const hook = (p, fn) => p.page.evaluate((f) => window.__tpFrenzy && window.__tpFrenzy[f](), fn);
async function room(browser, reducedMotion) {
  const P = [await phone(browser, "Jo", reducedMotion), await phone(browser, "Sam", reducedMotion), await phone(browser, "Priya", reducedMotion)];
  await P[0].page.locator("#hostbtn").click();
  await expect(P[0].page.locator("#lobby")).toBeVisible();
  const code = (await P[0].page.locator("#codebig").innerText()).trim();
  for (const p of P.slice(1)) {
    await p.page.locator("#roomcode").fill(code);
    await p.page.locator("#joinbtn").click();
    await expect(p.page.locator("#lobby")).toBeVisible();
  }
  await expect(P[0].page.locator("#start")).toBeEnabled();
  await P[0].page.locator("#start").click();
  await expect.poll(() => hook(P[0], "phase")).toBe("guess");
  return P;
}
/* the tiles of one grid row, as [class, symbol] pairs */
const rowTiles = (p, r) => p.page.evaluate((r) => [...document.querySelectorAll("#grid .fl-row")[r].querySelectorAll(".fl-tile")].map((t) => ({
  cls: ["lock", "move", "miss", "fl-pend", "fl-flip", "fl-hop"].filter((c) => t.classList.contains(c)),
  mark: (t.querySelector(".fl-mark") || {}).textContent || "",
  anim: getComputedStyle(t).animationName
})), r);
async function expectRow(p, r, want) {
  const tiles = await rowTiles(p, r);
  expect(tiles.length).toBe(5);
  tiles.forEach((t, i) => {
    expect(t.cls, "tile " + i).toContain(want[i][0]);
    expect(t.cls, "tile " + i).not.toContain("fl-pend");
    expect(t.mark, "tile " + i).toBe(want[i][1]);
  });
}

for (const reduced of [false, true]) {
  const label = reduced ? "with reduced motion" : "with motion";
  test(`frenzy effects ${label}: tiles end with the right marks and symbols, refusals shake, the drink banner, a solve`, async ({ browser }) => {
    const P = await room(browser, reduced ? "reduce" : "no-preference");
    const [jo, sam] = P;
    await expect(jo.page.locator("#turnlabel")).toHaveText("Your turn");
    await expect(sam.page.locator("#turnlabel .fl-who")).toHaveText("Jo");

    // typing: each new letter pops in, unless motion is reduced
    await jo.page.locator("#guess").pressSequentially("tra");
    const pop = await jo.page.evaluate(() => !!document.querySelector("#grid .fl-tile.fl-pop"));
    expect(pop).toBe(!reduced);
    await jo.page.locator("#guess").pressSequentially("ce");
    await jo.page.locator("#sendguess").click();

    // the row arrives on every phone; with reduced motion it is final at once, otherwise it flips in
    await expect(sam.page.locator("#grid .fl-row").first().locator(".fl-letter").first()).toHaveText("T");
    if (reduced) {
      for (const p of [jo, sam]) {
        await expectRow(p, 0, TRACE);
        for (const t of await rowTiles(p, 0)) { expect(t.cls).not.toContain("fl-flip"); expect(t.anim).toBe("none"); }
      }
      expect((await hook(jo, "anim")).reveal).toBeNull();
    } else {
      expect((await hook(sam, "anim")).reveal).not.toBeNull();
      await expect.poll(async () => (await rowTiles(sam, 0)).filter((t) => t.cls.includes("fl-flip")).length, { timeout: 2000 }).toBe(0);
      for (const p of [jo, sam]) await expectRow(p, 0, TRACE);
    }

    // the drink moment: a pink banner with the drink, the no-drink pose and Pass together
    await expect.poll(() => hook(jo, "phase")).toBe("prompt");
    const banner = jo.page.locator("#promptbox");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(/fl-drink/);
    await expect(jo.page.locator("#prompttext")).toHaveText(PROMPT);
    await expect(banner).toContainText("Drink moment");
    for (const id of ["#drinkbtn", "#posebtn", "#passbtn"]) {
      await expect(jo.page.locator(id)).toBeVisible();
      expect((await jo.page.locator(id).boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    expect(await banner.innerText()).not.toMatch(/\bsips?\b|water/i);
    const bg = await banner.evaluate((e) => getComputedStyle(e).backgroundColor);
    const pink = await jo.page.evaluate(() => { const d = document.createElement("div"); d.style.color = "var(--danger)"; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; });
    expect(bg).toBe(pink);
    await jo.page.locator("#passbtn").click();

    // a refused guess: the message in the message box, and the row shakes unless motion is reduced
    await expect.poll(() => hook(sam, "turn")).toBe(await hook(sam, "uid"));
    await expect(sam.page.locator("#turnlabel")).toHaveText("Your turn");
    await sam.page.locator("#guess").fill("trace");
    await sam.page.locator("#sendguess").click();
    await expect(sam.page.locator("#perr")).toHaveText("Already guessed.");
    expect(await sam.page.evaluate(() => !!document.querySelector("#grid .fl-row.fl-shake"))).toBe(!reduced);
    // input is never held up by the effects: the next guess goes straight in
    await sam.page.locator("#guess").fill("crane");
    await sam.page.locator("#sendguess").click();

    // solved: every tile locked; with motion the row bounces and confetti appears, then clears within 2 seconds
    const CRANE = Array(5).fill(["lock", "●"]);
    if (!reduced) {
      await expect.poll(() => sam.page.evaluate(() => !!document.querySelector("canvas.fl-confetti")), { timeout: 4000 }).toBe(true);
      expect((await hook(sam, "anim")).bounce).not.toBeNull();
      await expect.poll(() => sam.page.evaluate(() => !!document.querySelector("canvas.fl-confetti")), { timeout: 2600 }).toBe(false);
    } else {
      await expect(sam.page.locator("#grid .fl-row").nth(1).locator(".fl-mark").first()).toHaveText("●");
      await sam.page.waitForTimeout(1200);
      expect(await sam.page.evaluate(() => !!document.querySelector("canvas.fl-confetti"))).toBe(false);
    }
    for (const p of [jo, sam]) await expectRow(p, 1, CRANE);

    // the round ends: the word shows as tiles, and the share card has symbols only
    await expect.poll(() => hook(sam, "phase")).toBe("handoff");
    await sam.page.locator("#skiphand").click();
    await expect.poll(() => hook(jo, "phase")).toBe("end");
    await expect(jo.page.locator("#awards .fl-word")).toHaveAttribute("aria-label", "CRANE");
    await expect(jo.page.locator("#awards .fl-wtile")).toHaveCount(5);
    await expect(jo.page.locator("#sharecard")).toBeVisible();
    expect((await jo.page.locator("#sharecard").boundingBox()).height).toBeGreaterThanOrEqual(44);
    const card = await jo.page.evaluate(() => {
      const rows = window.__tpFrenzy.data().guesses.map((g) => g.marks);
      const cv = window.FrenzyFX.shareCanvas(rows, { solved: true, max: 6 });
      return { w: cv.width, h: cv.height, rows: rows.length, keys: Object.keys(window.__tpFrenzy.data().guesses[0]) };
    });
    expect(card.rows).toBe(2);
    expect(card.w).toBeGreaterThan(300);
    for (const p of P) expect(p.errors).toEqual([]);
    for (const p of P) await p.context.close();
  });
}

/* The round ends unsolved (the host ends it, which keeps this test well under the word keeper's 60 calls a minute;
   running out of guesses takes the same path on screen): the word turns over one tile at a time. */
test("frenzy effects: the word turns over one tile at a time when a round ends unsolved", async ({ browser }) => {
  const P = await room(browser, "no-preference");
  await P[0].page.locator("#guess").fill("house");
  await P[0].page.locator("#sendguess").click();
  await expect.poll(() => hook(P[0], "phase")).toBe("prompt");
  await P[0].page.locator("#endbtn").click();
  await expect.poll(() => hook(P[1], "phase")).toBe("end");
  await expect(P[1].page.locator("#awards .fl-word")).toHaveAttribute("aria-label", "CRANE");
  expect(typeof (await hook(P[1], "anim")).word).toBe("number");
  await expect(P[1].page.locator("#awards .fl-wtile")).toHaveCount(5);
  // the tiles turn over in order: shortly after the end some are still on their way in, and within 2 seconds all show
  const opac = () => P[1].page.evaluate(() => [...document.querySelectorAll("#awards .fl-wtile")].map((t) => +getComputedStyle(t).opacity));
  const early = await opac();
  expect(early[4]).toBeLessThan(1);
  await expect.poll(async () => (await opac()).every((o) => o === 1), { timeout: 2000 }).toBe(true);
  await expect(P[1].page.locator("#awards .fl-word")).toHaveText("CRANE");
  for (const p of P) await p.context.close();
});

/* Counts AudioContexts and oscillators, so a test can tell "nothing was scheduled" from "a sound was". */
async function counted(browser, sound) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: "block" });
  await context.route(/googletagmanager|google-analytics/, (r) => r.abort());
  await context.addInitScript((s) => {
    window.__ac = 0; window.__osc = 0;
    ["AudioContext", "webkitAudioContext"].forEach((k) => {
      const A = window[k];
      if (!A) return;
      window[k] = class extends A {
        constructor(...a) { super(...a); window.__ac++; }
        createOscillator() { window.__osc++; return super.createOscillator(); }
      };
    });
    localStorage.setItem("tp_age_ok", "yes");
    if (s) localStorage.setItem("tp_sound", s);
  }, sound);
  const page = await context.newPage();
  await page.goto(BASE + PAGE);
  await page.locator("#hostbtn").waitFor({ state: "visible" });
  return { context, page };
}
const everySound = (page) => page.evaluate(() => {
  const F = window.FrenzyFX;
  F.type(); F.reveal(["locked", "moved", "absent", "locked", "absent"]); F.reject(); F.turn(); F.solved(0); F.outOfGuesses(); F.clink();
});
const counts = (page) => page.evaluate(() => ({ ac: window.__ac, osc: window.__osc }));

test("frenzy sounds: silent until the player taps, silent when muted, and muted by default", async ({ browser }) => {
  // sound on, but nobody has tapped yet: every effect is asked for, nothing is made
  const a = await counted(browser, "on");
  await everySound(a.page);
  await a.page.waitForTimeout(300);
  expect(await counts(a.page)).toEqual({ ac: 0, osc: 0 });
  // after the first tap, the same calls make sound
  await a.page.locator("h1:visible").first().tap();
  await everySound(a.page);
  await expect.poll(async () => (await counts(a.page)).osc).toBeGreaterThan(10);
  // mute with the page's own button: the choice is remembered, and nothing more is made
  await a.page.locator("#mute").click();
  expect(await a.page.evaluate(() => localStorage.getItem("tp_sound"))).toBe("off");
  const before = (await counts(a.page)).osc;
  await everySound(a.page);
  await a.page.waitForTimeout(300);
  expect((await counts(a.page)).osc).toBe(before);
  await a.context.close();

  // a first visit with no saved choice starts muted on this game, as before
  const b = await counted(browser, null);
  await b.page.locator("h1:visible").first().tap();
  await everySound(b.page);
  await b.page.waitForTimeout(300);
  expect((await counts(b.page)).osc).toBe(0);
  await expect(b.page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
  await b.context.close();
});
