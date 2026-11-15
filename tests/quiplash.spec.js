/* Punchline Duel host flow with a stubbed Firebase (same stub as split-end.spec.js).
   The test page is the host; bot players and their answers/votes are injected through window.__tpMock.
   Nothing talks to production. */
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const BASE = process.env.TIPSY_BASE || "http://127.0.0.1:8765";
const src = fs.readFileSync(path.join(__dirname, "split-end.spec.js"), "utf8");
const mockSrc = src.slice(src.indexOf("const APP = `"), src.indexOf("function contrast"));
// eslint-disable-next-line no-new-func
const { APP, AUTH, DB } = new Function(mockSrc + "; return { APP, AUTH, DB };")();

async function open(browser, url, name){
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true });
  await context.route(/googletagmanager|google-analytics|analytics\.google/, (r) => r.abort());
  await context.route(/firebaseio\.com|firebasedatabase\.app|identitytoolkit|securetoken|firebaseapp\.com|gstatic\.com\/firebasejs/, (route) => {
    const u = route.request().url();
    if (u.includes("firebase-app.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: APP });
    if (u.includes("firebase-auth.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: AUTH });
    if (u.includes("firebase-database.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: DB });
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((n) => { localStorage.setItem("tp_age_ok", "yes"); localStorage.setItem("tp_sound", "off"); if (n) localStorage.setItem("tp_name", n); }, name);
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await page.locator("#pname").waitFor({ state: "visible", timeout: 15000 });
  return { context, page, errors };
}
const phase = (page) => page.evaluate(() => window.__tpQuip && window.__tpQuip.phase());
const data = (page) => page.evaluate(() => window.__tpQuip && window.__tpQuip.data());
const myUid = (page) => page.evaluate(() => window.__tpQuip && window.__tpQuip.uid());

async function hostWithBots(page, bots){
  await page.locator("#pname").fill("Ada");
  await page.locator("#hostbtn").click();
  await expect(page.locator("#lobby")).toBeVisible();
  const code = (await page.locator("#codebig").innerText()).trim();
  for (const b of bots) await page.evaluate(([c, b]) => window.__tpMock.addPlayer(c, b.id, b.name), [code, b]);
  return code;
}

test("the home screen loads with no opt-in box and a clear intro", async ({ browser }) => {
  const { context, page, errors } = await open(browser, "/games/punchline-duel.html", "Ada");
  await expect(page.locator("#home h1")).toHaveText("Punchline Duel");
  await expect(page.locator("#optin")).toHaveCount(0);
  await expect(page.locator("#hostbtn")).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("host a room: lobby shows the rounds and drinks chips and Start enables at three players", async ({ browser }) => {
  const { context, page, errors } = await open(browser, "/games/punchline-duel.html", "Ada");
  const code = await hostWithBots(page, [{ id: "p2", name: "Bo" }]);
  await expect(page.locator("#start")).toBeDisabled();         // 2 players
  await page.evaluate((c) => window.__tpMock.addPlayer(c, "p3", "Cy"), code);
  await expect(page.locator("#start")).toBeEnabled();          // 3 players
  await expect(page.locator('[data-rounds="8"]')).toBeVisible();
  await expect(page.locator('[data-drink="none"]')).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("a full round: answers come in, the table votes, the reveal names a winner", async ({ browser }) => {
  const { context, page, errors } = await open(browser, "/games/punchline-duel.html", "Ada");
  const code = await hostWithBots(page, [{ id: "p2", name: "Bo" }, { id: "p3", name: "Cy" }, { id: "p4", name: "Di" }]);
  await page.locator('[data-rounds="5"]').click();
  await page.locator("#start").click();

  // we are in the answer phase; find the two authors
  await expect.poll(() => phase(page)).toBe("answer");
  const host = await myUid(page);
  let d = await data(page);
  const authors = [d.a, d.b];

  // every author that is a bot gets an injected answer; if the host is an author, type it
  for (const a of authors){
    if (a === host){
      await expect(page.locator("#answerbox")).toBeVisible();
      await page.locator("#qlanswer").fill("the host's zinger");
      await page.locator("#qlsend").click();
    } else {
      await page.evaluate(([c, a]) => window.__tpMock.set("rooms/" + c + "/ql/ans/" + a, "bot answer " + a), [code, a]);
    }
  }

  // host advances to the vote
  await expect.poll(() => phase(page)).toBe("vote");
  d = await data(page);
  const seq = await page.evaluate(() => window.__tpQuip.seq());
  // non-authors all vote for answer A
  const voters = ["p2", "p3", "p4", host].filter((u) => u !== d.a && u !== d.b);
  for (const v of voters){
    if (v === host){
      await expect(page.locator("#votebox")).toBeVisible();
      await page.locator('#votelist button[data-side="a"]').click();
    } else {
      await page.evaluate(([c, v, seq]) => window.__tpMock.set("rooms/" + c + "/ql/vote/" + v, "a:" + seq), [code, v, seq]);
    }
  }

  // reveal appears with vote counts and a winner line
  await expect.poll(() => phase(page)).toBe("reveal");
  await expect(page.locator("#revealbox .ql-reveal.win")).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
