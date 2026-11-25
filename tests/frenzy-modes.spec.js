/* Five Letter Frenzy: Solo, Race and Table, on the Firebase emulators and the local word server.
   Nothing talks to production. Race needs the PHP endpoint, so the static server must run PHP. */
const { test, expect } = require("./harness");
const BASE = process.env.TIPSY_BASE || "http://127.0.0.1:8765";
const HOME = "/games/five-letter-frenzy.html";
const RACE = "/games/five-letter-race.html?emulator=1&fast=1&word=crane";

async function phone(browser, name, url, viewport) {
  const context = await browser.newContext({ viewport: viewport || { width: 390, height: 844 }, hasTouch: true, serviceWorkers: "block" });
  await context.route(/googletagmanager|google-analytics/, (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push((e && e.stack) || String(e)));
  page.on("request", (r) => requests.push(r.url()));
  await page.addInitScript((n) => {
    if (!localStorage.getItem("tp_age_ok")) localStorage.setItem("tp_age_ok", "yes");
    localStorage.setItem("tp_sound", "off");
    if (n) localStorage.setItem("tp_name", n);
  }, name);
  await page.goto(BASE + url);
  return { context, page, name, errors, requests };
}
const noOverflow = (p) => p.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const rphase = (p) => p.page.evaluate(() => window.__tpRace && window.__tpRace.phase());
async function raceRoom(browser) {
  const J = await phone(browser, "Jo", RACE);
  const S = await phone(browser, "Sam", RACE);
  await J.page.locator("#hostbtn").waitFor({ state: "visible" });
  await S.page.locator("#hostbtn").waitFor({ state: "visible" });
  await J.page.locator("#hostbtn").click();
  await expect(J.page.locator("#lobby")).toBeVisible();
  const code = (await J.page.locator("#codebig").innerText()).trim();
  await S.page.locator("#roomcode").fill(code);
  await S.page.locator("#joinbtn").click();
  await expect(S.page.locator("#lobby")).toBeVisible();
  await expect(J.page.locator("#start")).toBeEnabled();
  return { J, S, code };
}
async function startRace(J, S) {
  await J.page.locator("#start").click();
  for (const p of [J, S]) await expect.poll(() => rphase(p), { timeout: 20000 }).toBe("race");
}
async function send(p, word) {
  await p.page.locator("#guess").fill(word);
  await p.page.locator("#guess").press("Enter");
}

test.describe("Solo", () => {
  test("daily game: win, stats update, no double count on reload, share text has no letters", async ({ browser }) => {
    const p = await phone(browser, "Jo", HOME + "?emulator=1");
    await expect(p.page.locator("#modes")).toBeVisible();
    await p.page.locator("#mode-solo").click();
    await p.page.locator("#solo-daily").click();
    const word = await p.page.evaluate(() => window.__tpSolo.word());
    const expected = await p.page.evaluate(() => window.FrenzyModes.dailyWord(window.FrenzyModes.dateKey(), window.FRENZY_WORDS.answers));
    expect(word).toBe(expected);
    await p.page.locator("#soloinput").fill("house");
    await p.page.locator("#soloinput").press("Enter");
    await expect.poll(() => p.page.evaluate(() => window.__tpSolo.rows().length)).toBe(1);
    await p.page.locator("#soloinput").fill(word);
    await p.page.locator("#soloinput").press("Enter");
    await expect(p.page.locator("#soloresult")).toBeVisible({ timeout: 15000 });
    const stats = () => p.page.evaluate(() => JSON.parse(localStorage.getItem("tp_fl_solo_stats")));
    let s = await stats();
    expect(s.played).toBe(1); expect(s.wins).toBe(1); expect(s.streak).toBe(1); expect(s.dist[1]).toBe(1);
    const emoji = await p.page.locator("#soloemoji").innerText();
    expect(emoji).not.toMatch(/[a-z]/i);
    expect(emoji.trim().split("\n")).toHaveLength(2);
    // reload: the finished daily game comes back and is not counted again
    await p.page.reload();
    await p.page.locator("#mode-solo").click();
    await p.page.locator("#solo-daily").click();
    await expect(p.page.locator("#soloresult")).toBeVisible({ timeout: 15000 });
    s = await stats();
    expect(s.played).toBe(1);
    // share falls back to the clipboard text (no letters, no word)
    await p.page.evaluate(() => { window.__shared = null; Object.defineProperty(navigator, "share", { value: (d) => { window.__shared = d; return Promise.resolve(); }, configurable: true }); });
    await p.page.locator("#soloshare").click();
    await expect.poll(() => p.page.evaluate(() => window.__shared && window.__shared.text)).toMatch(/^Five Letter Frenzy Daily \d{4}-\d{2}-\d{2} 2\/6/);
    const shared = await p.page.evaluate(() => window.__shared.text);
    expect(shared.toLowerCase()).not.toContain(word);
    expect(shared.toLowerCase()).not.toContain("house");
    expect(p.errors).toEqual([]);
    await p.context.close();
  });

  test("solo is network-free and its assets are precached", async ({ browser }) => {
    const p = await phone(browser, "Jo", HOME);
    await p.page.locator("#mode-solo").click();
    await p.page.locator("#solo-random").click();
    await p.page.locator("#soloinput").fill("house");
    await p.page.locator("#soloinput").press("Enter");
    await p.page.waitForTimeout(1200);
    const bad = p.requests.filter((u) => /firebase|gstatic|frenzy-word\.php|googleapis/.test(u));
    expect(bad).toEqual([]);
    const fs = require("fs"), path = require("path");
    const root = process.env.TIPSY_ROOT || path.join(__dirname, "..");
    const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
    for (const page of ["games/five-letter-frenzy.html", "games/five-letter-race.html"]) {
      const html = fs.readFileSync(path.join(root, page), "utf8");
      for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
        const src = m[1];
        if (/^https?:/.test(src)) continue;
        const rel = src.replace(/^\.\.\//, "");
        expect(sw, page + " needs " + rel + " in the precache").toContain(rel);
      }
    }
    await p.context.close();
  });
});

test.describe("Race", () => {
  test("two phones race the same word: faster solver wins, both see the leaderboard, word revealed at the end", async ({ browser }) => {
    const { J, S } = await raceRoom(browser);
    await startRace(J, S);
    // empty boards at the start
    expect(await J.page.evaluate(() => window.__tpRace.rows())).toEqual([]);
    expect(await S.page.evaluate(() => window.__tpRace.rows())).toEqual([]);
    await send(J, "house");
    await expect.poll(() => J.page.evaluate(() => window.__tpRace.rows().length)).toBe(1);
    await send(S, "crate");
    await expect.poll(() => S.page.evaluate(() => window.__tpRace.rows().length)).toBe(1);
    // the other phone sees only progress, never letters or colours, and no secret word
    const seen = await J.page.evaluate(() => JSON.stringify(window.__tpRace.prog()));
    expect(seen).not.toMatch(/house|crate|crane/i);
    expect(await J.page.evaluate(() => window.__tpRace.word() || null)).toBeNull();
    await send(S, "crane"); // Sam solves in 2
    await expect.poll(() => S.page.evaluate(() => window.__tpRace.st())).toBeTruthy();
    await send(J, "music");
    await expect.poll(() => J.page.evaluate(() => window.__tpRace.rows().length)).toBe(2);
    await send(J, "crane"); // Jo solves in 3
    for (const p of [J, S]) await expect.poll(() => rphase(p), { timeout: 30000 }).toBe("results");
    for (const p of [J, S]) {
      await expect(p.page.locator("#finale")).toBeVisible();
      await expect.poll(() => p.page.evaluate(() => window.__tpRace.word())).toBe("crane");
      const ranks = await p.page.evaluate(() => window.__tpRace.ranks());
      expect(ranks).toHaveLength(2);
      expect(ranks.map((r) => r.status)).toEqual(["solved", "solved"]);
      expect(ranks[0].n).toBe(2);
      expect(ranks[1].n).toBe(3);
      await expect(p.page.locator("#results li")).toHaveCount(2);
      expect(await noOverflow(p)).toBe(true);
    }
    const winnerUid = await S.page.evaluate(() => window.__tpRace.uid());
    expect((await J.page.evaluate(() => window.__tpRace.ranks()))[0].uid).toBe(winnerUid);
    expect(J.errors).toEqual([]); expect(S.errors).toEqual([]);
    await J.context.close(); await S.context.close();
  });

  test("a refresh mid-race restores the board", async ({ browser }) => {
    const { J, S } = await raceRoom(browser);
    await startRace(J, S);
    await send(S, "house");
    await expect.poll(() => S.page.evaluate(() => window.__tpRace.rows().length)).toBe(1);
    await send(S, "music");
    await expect.poll(() => S.page.evaluate(() => window.__tpRace.rows().length)).toBe(2);
    await S.page.reload();
    await expect.poll(() => S.page.evaluate(() => window.__tpRace && window.__tpRace.rows().length), { timeout: 20000 }).toBe(2);
    expect(await S.page.evaluate(() => window.__tpRace.rows())).toEqual(["house", "music"]);
    expect(await rphase(S)).toBe("race");
    // and the restored board keeps working
    await send(S, "crane");
    await expect.poll(() => S.page.evaluate(() => window.__tpRace.st())).toBeTruthy();
    await J.context.close(); await S.context.close();
  });

  test("360px layout has no horizontal scroll on the race screens", async ({ browser }) => {
    const J = await phone(browser, "Jo", RACE, { width: 360, height: 740 });
    await J.page.locator("#hostbtn").waitFor({ state: "visible" });
    expect(await noOverflow(J)).toBe(true);
    await J.page.locator("#hostbtn").click();
    await expect(J.page.locator("#lobby")).toBeVisible();
    expect(await noOverflow(J)).toBe(true);
    await J.context.close();
  });
});

test.describe("Modes", () => {
  test("360px: picker and solo screens do not scroll sideways", async ({ browser }) => {
    const p = await phone(browser, "Jo", HOME + "?emulator=1", { width: 360, height: 740 });
    await expect(p.page.locator("#modes")).toBeVisible();
    expect(await noOverflow(p)).toBe(true);
    await p.page.locator("#mode-solo").click();
    expect(await noOverflow(p)).toBe(true);
    await p.page.locator("#solo-random").click();
    expect(await noOverflow(p)).toBe(true);
    await p.context.close();
  });

  test("Table mode is still reachable from the picker", async ({ browser }) => {
    const p = await phone(browser, "Jo", HOME + "?emulator=1&fast=1&word=crane");
    await p.page.locator("#mode-table").click();
    await expect(p.page.locator("#hostbtn")).toBeVisible({ timeout: 20000 });
    await p.page.locator("#hostbtn").click();
    await expect(p.page.locator("#lobby")).toBeVisible();
    await p.context.close();
  });
});
