/* King's Cup screens: joined view, invite view, tap race, 5-second clock, call out, Never Have I Ever on Jack.
   Firebase is stubbed in the page (same stub as split-end.spec.js). Nothing talks to production. */
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
async function startRoom(page){
  await page.locator("#pname").fill("Ada");
  await page.locator("#hostbtn").click();
  await expect(page.locator("#lobby")).toBeVisible();
  const code = (await page.locator("#codebig").innerText()).trim();
  await page.evaluate((c) => window.__tpMock.addPlayer(c, "p2", "Bo"), code);
  return code;
}
async function showCard(page, code, card, step = "shown"){
  await page.evaluate(([c, card, step]) => {
    window.__tpMock.set("rooms/" + c + "/kc/play", { turn: "host-1", kings: 0, step, card, echo: "", seq: 7, left: 40, target: "", order: "host-1,p2" });
  }, [code, card, step]);
}

test("lobby has no opt-in box, the Deal button works with two players, and the rules text is gone once joined", async ({ browser }) => {
  const { context, page, errors } = await open(browser, "/games/kings-cup.html", "Ada");
  await expect(page.locator("#below")).toBeVisible();
  await expect(page.locator("#safer-play")).toHaveCount(0);
  await expect(page.locator("#optin")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Opt in");
  await startRoom(page);
  await expect(page.locator("#below")).toBeHidden();
  await expect(page.locator("#start")).toBeEnabled();
  await page.locator("#start").click();
  await expect(page.locator("#table")).toBeVisible();
  await expect(page.locator("#below")).toBeHidden();
  expect(errors).toEqual([]);
  await context.close();
});

test("emulator=1 is not a room code, and a real invite still hides Host", async ({ browser }) => {
  const emu = await open(browser, "/games/kings-cup.html?emulator=1", "");
  await expect(emu.page.locator("#hostbtn")).toBeVisible();
  await expect(emu.page.locator("#roomcode")).toHaveValue("");
  await expect(emu.page.locator("#invited")).toBeHidden();
  await emu.page.emulateMedia({ reducedMotion: "reduce" });
  await emu.page.evaluate(() => window.__tpKc.burst(30));
  expect(await emu.page.evaluate(() => window.__tpKc.parts())).toBe(0);
  await emu.page.emulateMedia({ reducedMotion: "no-preference" });
  await emu.page.evaluate(() => window.__tpKc.burst(4));
  expect(await emu.page.evaluate(() => window.__tpKc.parts())).toBe(4);
  await emu.context.close();

  const room = await open(browser, "/games/kings-cup.html?room=WXYZ&emulator=1", "Cy");
  await expect(room.page.locator("#hostbtn")).toBeHidden();
  await expect(room.page.locator("#roomcode")).toHaveValue("WXYZ");
  await expect(room.page.locator("#joinbtn")).toHaveText("Join room");
  await room.context.close();
});

test("an invite link hides Host Game and offers Join room", async ({ browser }) => {
  const { context, page } = await open(browser, "/games/kings-cup.html?code=ABCD", "Cy");
  await expect(page.locator("#hostbtn")).toBeHidden();
  await expect(page.locator("#invited")).toBeVisible();
  await expect(page.locator("#joinbtn")).toHaveText("Join room");
  await expect(page.locator("#roomcode")).toHaveValue("ABCD");
  await context.close();
});

test("Heaven shows a TAP button and names the last phone", async ({ browser }) => {
  const { context, page } = await open(browser, "/games/kings-cup.html", "Ada");
  const code = await startRoom(page);
  await page.locator("#start").click();
  await showCard(page, code, "7S");
  await expect(page.locator("#tapzone")).toBeVisible();
  await page.locator("#tapbtn").click();
  await expect(page.locator("#tapbtn")).toBeDisabled();
  await page.evaluate((c) => window.__tpMock.set("rooms/" + c + "/kc/tap/p2", { s: 7, t: Date.now() + 500 }), code);
  await expect(page.locator("#tapresult")).toHaveText("Bo was last.");
  await context.close();
});

test("Rhyme starts a 5-second clock that passes on and runs out", async ({ browser }) => {
  const { context, page } = await open(browser, "/games/kings-cup.html", "Ada");
  const code = await startRoom(page);
  await page.locator("#start").click();
  await showCard(page, code, "9H");
  await expect(page.locator("#timerstart")).toBeVisible();
  await page.locator("#timerstart").click();
  await expect(page.locator("#timerpass")).toBeVisible();
  await page.locator("#timerpass").click();
  await expect(page.locator("#timerline")).toContainText("Bo has the clock");
  await expect(page.locator("#clock")).toHaveText("0", { timeout: 8000 });
  await expect(page.locator("#timerline")).toContainText("Bo ran out of time");
  await context.close();
});

test("Queen has a Call out button and Jack reads a Never Have I Ever line", async ({ browser }) => {
  const { context, page } = await open(browser, "/games/kings-cup.html", "Ada");
  const code = await startRoom(page);
  await page.locator("#start").click();
  await showCard(page, code, "QD");
  await expect(page.locator("#callbtn")).toBeVisible();
  await page.locator("#callbtn").click();
  await expect(page.locator("#callline")).toContainText("Ada called out");
  await showCard(page, code, "JC");
  await expect(page.locator("#nhieline")).toContainText("Never have I ever");
  await expect(page.locator("#callbtn")).toBeHidden();
  await context.close();
});

test("a King before the fourth lets the drawer write a house rule or pass", async ({ browser }) => {
  const { context, page } = await open(browser, "/games/kings-cup.html", "Ada");
  const code = await startRoom(page);
  await page.locator("#start").click();
  await showCard(page, code, "KS");
  await expect(page.locator("#jackrule")).toBeVisible();
  await expect(page.locator("#choicepass")).toBeVisible();
  await context.close();
});
