/* Split Decision Phase 2 on three phones, against the Firebase emulator and the real rules:
   confidence stakes (including a costly miss), auto-advance with Pause and Resume,
   a sudden-death win after a tie, and the end-of-game stats. Uses &fast=1 for a 3-second hold. */
const { test, expect } = require("@playwright/test");
const L = require("../play/poster-logic.js");

const BASE = process.env.TIPSY_BASE || "http://127.0.0.1:8765";
const GAME = "/games/split-decision.html?emulator=1&fast=1";

async function boot(browser, name){
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 360, height: 780 }, hasTouch: true });
  await context.route(/googletagmanager|google-analytics|analytics\.google/, (route) => route.abort());
  await context.route(/\/assets\/video\//, (route) => route.fulfill({ status: 404, body: "" }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((n) => {
    localStorage.setItem("tp_age_ok", "yes");
    localStorage.setItem("tp_sound", "off");
    localStorage.setItem("tp_name", n);
  }, name);
  await page.goto(BASE + GAME, { waitUntil: "domcontentloaded" });
  await page.locator("#hostbtn").waitFor({ state: "visible" });
  return { name, context, page, errors };
}
const pick = (p, letter) => p.page.locator(".poster-choice", { hasText: new RegExp("^" + letter + " ·") }).click();
async function guess(p, n, stake){
  await expect(p.page.locator("#statusline")).toContainText("How many");
  await expect(p.page.locator("#sdstake")).toBeVisible();
  await expect(p.page.locator('#sdstake [data-stake="1"]')).toHaveAttribute("aria-pressed", "true");
  if (stake && stake > 1) {
    await p.page.locator('#sdstake [data-stake="' + stake + '"]').click();
    await expect(p.page.locator('#sdstake [data-stake="' + stake + '"]')).toHaveAttribute("aria-pressed", "true");
    await expect(p.page.locator("#sdstakehint")).toContainText(stake + "x");
  }
  await p.page.locator(".poster-choice", { hasText: new RegExp("^" + n + "$") }).click();
}
const roundNo = (p) => p.page.evaluate(() => window.__tpTest.round());

test("stakes, auto-advance with pause, a sudden-death win, and the game stats", async ({ browser }) => {
  test.setTimeout(240000);
  const ada = await boot(browser, "Ada"), bea = await boot(browser, "Bea"), cal = await boot(browser, "Cal");
  const ps = [ada, bea, cal];
  await ada.page.locator("#pname").fill("Ada");
  await ada.page.locator("#hostbtn").click();
  await expect(ada.page.locator("#codebig")).toHaveText(/^[A-Z]{4}$/);
  const code = (await ada.page.locator("#codebig").innerText()).trim();
  for (const p of [bea, cal]) {
    await p.page.locator("#roomcode").fill(code);
    await p.page.locator("#joinbtn").click();
    await expect(p.page.locator("#lobby")).toBeVisible();
  }
  await ada.page.locator("#optin").check();
  await ada.page.locator("#start").click();

  // Round 1: Ada bets 2x and is exact (+4). Bea is exact at 1x (+2). Cal bets 3x and misses (-2).
  await Promise.all([pick(ada, "A"), pick(bea, "A"), pick(cal, "B")]);
  await Promise.all([guess(ada, 1, 2), guess(bea, 1), guess(cal, 0, 3)]);
  // The host pauses straight away (the test hold is only 3 seconds), so the checks can take their time.
  await expect(ada.page.locator("#pausebtn")).toBeVisible();
  await ada.page.locator("#pausebtn").click();
  await expect(bea.page.locator("#sdnext")).toHaveText("Paused by the host.");
  await expect(ada.page.locator("#pausebtn")).toHaveText("Resume");
  await expect(bea.page.locator("#pausebtn")).toBeHidden();
  for (const p of ps) await expect(p.page.locator(".sd-me")).toBeVisible();
  await expect(ada.page.locator(".sd-me-num")).toHaveText("+4");
  await expect(ada.page.locator(".sd-me-stake")).toHaveText("Bet 2x");
  await expect(cal.page.locator(".sd-me-num")).toHaveText("-2");
  await expect(cal.page.locator(".sd-me .sd-badge")).toHaveText("MISS");
  const calCard = bea.page.locator(".sd-pcard", { has: bea.page.locator(".sd-pname", { hasText: /^Cal$/ }) });
  await expect(calCard.locator(".sd-pline")).toHaveText("Picked B · guessed 0 · 3x");
  await expect(calCard.locator(".sd-ppts")).toHaveText("-2");
  await expect(bea.page.locator(".sd-row").last().locator(".sd-total")).toHaveText("-2");
  // Paused well past the hold: still on round 1.
  await ada.page.waitForTimeout(4000);
  expect(await roundNo(bea)).toBe(0);
  await expect(bea.page.locator("#sdnext")).toHaveText("Paused by the host.");
  await ada.page.locator("#pausebtn").click();
  await expect(bea.page.locator("#sdnext")).toContainText(/Next question in [1-3]/);

  // Resumed: round 2 starts on its own, no Continue tap. Bea bets 2x and is exact (+4).
  await expect(cal.page.locator("#roundlabel")).toHaveText("Round 2 of 8", { timeout: 10000 });
  await Promise.all([pick(ada, "A"), pick(bea, "A"), pick(cal, "B")]);
  await Promise.all([guess(ada, 1), guess(bea, 1, 2), guess(cal, 2)]);

  // Rounds 3 to 8 all advance by themselves. Ada and Bea stay level; Cal is always the minority.
  for (let r = 3; r <= 8; r++) {
    await expect(ada.page.locator("#roundlabel")).toHaveText("Round " + r + " of 8", { timeout: 10000 });
    await Promise.all([pick(ada, "A"), pick(bea, "A"), pick(cal, "B")]);
    await Promise.all([guess(ada, 1), guess(bea, 1), guess(cal, 2)]);
  }
  await expect(ada.page.locator(".sd-me")).toBeVisible();
  await expect(ada.page.locator("#sdnext")).toContainText("Sudden death in");
  await expect(ada.page.locator(".sd-row.leader")).toHaveCount(2);

  // Tie at 18: sudden death starts on its own for Ada and Bea; Cal watches.
  await expect(cal.page.locator("#roundlabel")).toHaveText("Sudden death 1", { timeout: 10000 });
  await expect(cal.page.locator("#statusline")).toHaveText("Sudden death: Ada vs Bea. You're watching this one.");
  await expect(cal.page.locator(".poster-choice")).toHaveCount(0);
  await expect(ada.page.locator("#sdwho li")).toHaveCount(2);
  // Ada picks A and says 0 (exact, +2); Bea picks B and says 0 (target 1: one away, +1).
  await Promise.all([pick(ada, "A"), pick(bea, "B")]);
  await expect(ada.page.locator(".poster-choice")).toHaveCount(2); // 0 or 1: one other player
  await Promise.all([guess(ada, 0), guess(bea, 0)]);
  await expect(cal.page.locator(".sd-pcard")).toHaveCount(2);
  await expect(cal.page.locator(".sd-me")).toHaveCount(0);

  // Ada leads 20 to 19: the game ends on its own.
  for (const p of ps) await expect(p.page.locator("#finale")).toBeVisible({ timeout: 10000 });
  await expect(cal.page.locator("#awards .poster-award")).toContainText("Won in sudden death");
  await expect(cal.page.locator("#awards .poster-award h2")).toHaveText("Ada");
  await expect(cal.page.locator("#awards .poster-award")).toContainText("20 points.");
  await expect(cal.page.locator("#recapline")).toHaveText("Split Decision, 8 rounds + sudden death");
  // Final standings, highest first.
  await expect(cal.page.locator("#awards .reveal-row")).toHaveText([/^Ada\s*20 points$/, /^Bea\s*19 points$/, /^Cal\s*12 points$/]);

  // Game stats match gameAwards over the stored rows.
  const cast = (await ada.page.evaluate(() => window.__tpTest.readPath("rooms/" + window.__tpTest.code() + "/nhie/cast"))).val;
  const players = (await ada.page.evaluate(() => window.__tpTest.readPath("rooms/" + window.__tpTest.code() + "/players"))).val;
  const entries = Object.keys(cast).map((id) => Object.assign({ id }, L.decodeResult(cast[id])));
  const expected = L.gameAwards(entries);
  const name = (id) => players[id].name;
  const award = (key) => cal.page.locator('.sd-award[data-award="' + key + '"]');
  await expect(cal.page.locator(".sd-award")).toHaveCount(expected.length);
  for (const a of expected) {
    await expect(award(a.key).locator(".sd-award-n")).toHaveText(a.ids.map(name).join(", "));
    await expect(award(a.key).locator(".sd-award-l")).toHaveText(a.line);
  }
  await expect(award("reader").locator(".sd-award-n")).toHaveText("Ada");
  await expect(award("contrarian").locator(".sd-award-n")).toHaveText("Cal");
  await expect(award("roller").locator(".sd-award-n")).toHaveText("Ada, Bea");
  await expect(award("near").locator(".sd-award-n")).toHaveText("Bea");

  for (const p of ps) {
    const over = await p.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(over).toBe(false);
    expect(p.errors, p.name + " page errors").toEqual([]);
    await p.context.close();
  }
});
