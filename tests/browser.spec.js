const { test, expect } = require("@playwright/test");
const jsqr = require("jsqr");
const fs = require("fs");
const path = require("path");

const ART = "/opt/cursor/artifacts";
const BASE = process.env.TIPSY_BASE || "http://127.0.0.1:8765";
fs.mkdirSync(ART, { recursive: true });

async function shot(page, name){
  const file = path.join(ART, name + ".png");
  await page.screenshot({ path: file, fullPage: false });
  return file;
}
async function boot(browser, gamePath, name, viewport){
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: viewport || { width: 390, height: 844 },
    hasTouch: true
  });
  const ga = [];
  const prod = [];
  await context.route(/googletagmanager|google-analytics|analytics\.google/, (route) => {
    ga.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on("request", (req) => {
    if (/firebaseio\.com|firebaseapp\.com/.test(req.url())) prod.push(req.url());
  });
  await page.addInitScript((player) => {
    localStorage.setItem("tp_age_ok", "yes");
    localStorage.setItem("tp_sound", "off");
    localStorage.setItem("tp_name", player);
  }, name);
  await page.goto(BASE + gamePath + "?emulator=1", { waitUntil: "domcontentloaded" });
  await page.locator("#app").waitFor({ state: "visible" });
  await page.locator("#hostbtn").waitFor({ state: "visible" });
  return { context, page, ga, prod };
}
async function hostRoom(page, name){
  await page.locator("#pname").fill(name);
  await page.locator("#hostbtn").click();
  await expect(page.locator("#lobby")).toBeVisible();
  const code = (await page.locator("#codebig").innerText()).trim();
  expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
  return code;
}
async function joinRoom(page, name, code){
  await page.locator("#pname").fill(name);
  await page.locator("#roomcode").fill(code);
  await page.locator("#joinbtn").click();
  await expect(page.locator("#lobby")).toBeVisible();
}
async function decodeQr(page){
  const pixels = await page.locator("#qr").evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { w: canvas.width, h: canvas.height, data: Array.from(img.data) };
  });
  const decoded = jsqr(Uint8ClampedArray.from(pixels.data), pixels.w, pixels.h);
  return decoded && decoded.data;
}
async function overflow(page){
  return page.evaluate(() => {
    const doc = document.documentElement;
    return { scroll: doc.scrollWidth, client: doc.clientWidth, over: doc.scrollWidth > doc.clientWidth + 1 };
  });
}

test("age gate keeps the invite, QR decodes, layout holds", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.removeItem("tp_age_ok"));
  await page.goto(BASE + "/games/split-decision.html?room=ABCD&game=split&emulator=1");
  await expect(page.locator("#gate")).toBeVisible();
  await expect(page.locator("#roomcode")).toHaveValue("ABCD");
  await page.locator("#gyes").click();
  await expect(page.locator("#gate")).toHaveCount(0);
  await expect(page.locator("#roomcode")).toHaveValue("ABCD");
  await expect(page.locator("body")).toContainText("You must be of legal drinking age in your location.");
  const tags = await page.locator("script[src*='G-BHY4BXF3V3']").count();
  expect(tags).toBe(1);
  await shot(page, "split-home-mobile");

  const host = await boot(browser, "/games/split-decision.html", "Ada");
  const code = await hostRoom(host.page, "Ada");
  await expect(host.page.locator("#qr")).toBeVisible();
  await expect(host.page.getByText("Scan to join")).toBeVisible();
  const link = (await host.page.locator("#sharelink").innerText()).trim();
  const qr = await decodeQr(host.page);
  expect(qr).toBe(link);
  expect(link).toContain("room=" + code);
  expect(link).toContain("game=split");
  expect(link).toContain("/games/split-decision.html");
  await shot(host.page, "split-lobby-qr-mobile");
  const narrow = await browser.newContext({ viewport: { width: 320, height: 700 }, serviceWorkers: "block" });
  const narrowPage = await narrow.newPage();
  await narrowPage.addInitScript(() => { localStorage.setItem("tp_age_ok","yes"); localStorage.setItem("tp_sound","off"); });
  await narrowPage.goto(BASE + "/games/split-decision.html?emulator=1");
  await narrowPage.locator("#app").waitFor({ state: "visible" });
  expect((await overflow(narrowPage)).over).toBe(false);
  const wide = await boot(browser, "/games/split-decision.html", "Ada", { width: 1280, height: 800 });
  expect((await overflow(wide.page)).over).toBe(false);
  await shot(wide.page, "split-home-desktop");
  const tiny = await wide.page.evaluate(() => {
    return Array.from(document.querySelectorAll("button, a.btn, input")).filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      return r.width < 43.5 || r.height < 43.5;
    }).map((el) => (el.id || el.textContent || "").trim().slice(0, 40));
  });
  expect(tiny).toEqual([]);
  await context.close();
  await host.context.close();
  await narrow.close();
  await wide.context.close();
});

test("split full game, hidden answers, rematch, refresh, host away", async ({ browser }) => {
  const ada = await boot(browser, "/games/split-decision.html", "Ada");
  const bea = await boot(browser, "/games/split-decision.html", "Bea");
  const cal = await boot(browser, "/games/split-decision.html", "Cal");
  const code = await hostRoom(ada.page, "Ada");
  await joinRoom(bea.page, "Bea", code);
  await joinRoom(cal.page, "Cal", code);
  await ada.page.locator("#optin").check();
  await ada.page.locator("#start").click();
  await expect(ada.page.locator("#table")).toBeVisible();

  const adaUid = await ada.page.evaluate(() => window.__tpTest.uid());
  await ada.page.locator(".poster-choice").first().click();
  await expect(ada.page.locator("#statusline")).toContainText(/Locked/);
  const leaked = await bea.page.evaluate((uid) => {
    return window.__tpTest.readPath("rooms/" + window.__tpTest.code() + "/sealed/1/0/" + uid);
  }, adaUid);
  expect(leaked.ok).toBe(false);
  expect(String(leaked.error)).toMatch(/permission|denied/i);
  const guestWrite = await bea.page.evaluate(() => window.__tpTest.guestWrite());
  expect(guestWrite.ok).toBe(false);
  expect(ada.prod.concat(bea.prod, cal.prod)).toEqual([]);

  async function lockPref(page, letter){
    await page.locator(".poster-choice", { hasText: new RegExp("^" + letter + " ·") }).click();
  }
  async function lockCount(page, n){
    await expect(page.locator("#statusline")).toContainText("How many", { timeout: 20000 });
    await page.locator(".poster-choice", { hasText: new RegExp("^" + n + "$") }).click();
  }
  await lockPref(bea.page, "A");
  await lockPref(cal.page, "B");
  await expect(bea.page.locator("#table")).not.toContainText("Ada ·");
  await lockCount(ada.page, "1");
  await lockCount(bea.page, "1");
  await lockCount(cal.page, "0");
  await expect(ada.page.locator("#revealbox")).toBeVisible();
  const opened = await bea.page.evaluate((uid) => {
    return window.__tpTest.readPath("rooms/" + window.__tpTest.code() + "/sealed/1/0/" + uid);
  }, adaUid);
  expect(opened.ok).toBe(true);
  expect(String(opened.val)).toMatch(/^A\|/);
  await shot(ada.page, "split-reveal-mobile");
  await ada.page.locator("#nextround").click();

  for (let round = 1; round < 8; round++){
    await expect(ada.page.locator("#kicker")).toBeVisible();
    await expect(ada.page.locator(".poster-choice").first()).toBeVisible();
    await lockPref(ada.page, "A");
    await lockPref(bea.page, "A");
    await lockPref(cal.page, "B");
    await lockCount(ada.page, "1");
    await lockCount(bea.page, "1");
    await lockCount(cal.page, "0");
    await expect(ada.page.locator("#revealbox")).toBeVisible();
    if (round < 7) await ada.page.locator("#nextround").click();
  }
  await ada.page.locator("#nextround").click();
  await expect(ada.page.locator("#finale")).toBeVisible();
  await expect(ada.page.locator("#awards")).toContainText("Shared win");
  await shot(ada.page, "split-finale-mobile");

  const before = await bea.page.evaluate(() => window.__tpTest.uid());
  await bea.page.reload({ waitUntil: "domcontentloaded" });
  await bea.page.locator("#app").waitFor({ state: "visible" });
  await expect.poll(async () => bea.page.evaluate((uid) => ({
    same: !!(window.__tpTest && window.__tpTest.uid() === uid),
    step: window.__tpTest ? window.__tpTest.step() : null,
    err: (document.getElementById("perr") && document.getElementById("perr").textContent) || ""
  }), before), { timeout: 20000 }).toMatchObject({ same: true, step: "over" });
  await expect(bea.page.locator("#finale")).toBeVisible();
  await ada.page.locator("#again").click();
  await expect(ada.page.locator("#lobby")).toBeVisible();
  await expect(bea.page.locator("#lobby")).toBeVisible({ timeout: 20000 });
  await ada.page.locator("#optin").check();
  await ada.page.locator("#start").click();
  await expect(cal.page.locator("#table")).toBeVisible();
  await ada.context.setOffline(true);
  await expect(bea.page.locator("#away")).toBeVisible({ timeout: 20000 });
  await ada.context.setOffline(false);
  await ada.page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(bea.page.locator("#away")).toBeHidden({ timeout: 20000 });
  await ada.context.close();
  await bea.context.close();
  await cal.context.close();
});

test("never have i ever still plays and shows a local QR", async ({ browser }) => {
  const ada = await boot(browser, "/games/never-have-i-ever.html", "Ada");
  const bea = await boot(browser, "/games/never-have-i-ever.html", "Bea");
  const cal = await boot(browser, "/games/never-have-i-ever.html", "Cal");
  await ada.page.locator("#pname").fill("Ada");
  await ada.page.locator("#hostbtn").click();
  await expect(ada.page.locator("#lobby")).toBeVisible();
  const code = (await ada.page.locator("#codebig").innerText()).trim();
  await expect(ada.page.locator("#qr")).toBeVisible();
  const link = (await ada.page.locator("#sharelink").innerText()).trim();
  expect(await decodeQr(ada.page)).toBe(link);
  expect(link).toContain("room=" + code);
  expect(link).toContain("game=nhie");
  expect(link.startsWith("http://127.0.0.1") || link.startsWith("http://localhost")).toBe(true);
  await joinRoom(bea.page, "Bea", code);
  await joinRoom(cal.page, "Cal", code);
  await ada.page.locator("[data-len='5']").click();
  await ada.page.locator("#optin").check();
  await ada.page.locator("#start").click();
  await expect(ada.page.locator("#ihave")).toBeVisible();
  for (let round = 0; round < 5; round++){
    await expect(bea.page.locator("#haves")).toBeHidden();
    await ada.page.locator("#ihave").click();
    await bea.page.locator("#never").click();
    await cal.page.locator("#never").click();
    await expect(ada.page.locator("#haves")).toBeVisible();
    const hidden = await bea.page.locator("#haves").innerText();
    expect(hidden.length).toBeGreaterThan(0);
    if (round < 4) await ada.page.locator("#nextround").click();
    else await ada.page.locator("#nextround").click();
  }
  await expect(ada.page.locator("#finale")).toBeVisible();
  await shot(ada.page, "nhie-finale-mobile");
  expect(ada.ga.concat(bea.ga, cal.ga).length).toBeGreaterThan(0);
  await ada.context.close();
  await bea.context.close();
  await cal.context.close();
});

test("nhie clock, names, join errors, and a delayed confession", async ({ browser }) => {
  const ada = await boot(browser, "/games/never-have-i-ever.html", "Sam");
  const bea = await boot(browser, "/games/never-have-i-ever.html", "Sam");
  await ada.page.goto(BASE + "/games/never-have-i-ever.html?emulator=1&fast=1");
  await bea.page.goto(BASE + "/games/never-have-i-ever.html?emulator=1&fast=1");
  await ada.page.locator("#app").waitFor({ state: "visible" });
  await bea.page.locator("#app").waitFor({ state: "visible" });
  const cleaned = await ada.page.evaluate(() => window.__tpNhie.clean("I have a secret"));
  expect(cleaned).toBe("Never have I ever I have a secret");
  const code = await hostRoom(ada.page, "Sam");
  await joinRoom(bea.page, "Sam", code);
  await expect(ada.page.locator("#plist")).toContainText("Sam 2");
  await ada.page.locator("#roomcode").count();
  const stranger = await boot(browser, "/games/never-have-i-ever.html", "No");
  await stranger.page.locator("#pname").fill("No");
  await stranger.page.locator("#roomcode").fill("ZZZZ");
  await stranger.page.locator("#joinbtn").click();
  await expect(stranger.page.locator("#perr")).toHaveText("No room with that code.");
  await ada.page.locator("[data-len='5']").click();
  await ada.page.locator("#optin").check();
  await ada.page.locator("#start").click();
  await expect(ada.page.locator("#ihave")).toBeVisible();
  await stranger.page.locator("#roomcode").fill(code);
  await stranger.page.locator("#joinbtn").click();
  await expect(stranger.page.locator("#perr")).toHaveText("This room is closed to new players.");
  await expect(stranger.page.locator("#hostnew")).toHaveText("Host a new room");
  await bea.page.evaluate(() => { window.__tpNhie.delayCast = 2000; });
  await ada.page.locator("#never").click();
  await bea.page.locator("#ihave").click();
  await expect(ada.page.locator("#drinkhead")).toHaveText("Take a drink or pass", { timeout: 15000 });
  await expect(ada.page.locator("#havelist")).toContainText("Sam");
  await expect.poll(async () => bea.page.evaluate(() => window.__tpNhie.confessions()), { timeout: 10000 }).toBe(1);
  const live = await ada.page.locator("#clock").getAttribute("aria-live");
  expect(live).toBeNull();
  await shot(ada.page, "nhie-drink-heading");
  await ada.context.close();
  await bea.context.close();
  await stranger.context.close();
});

test("nhie round feel: who has answered, the reveal count, one shared storyteller, and award cards", async ({ browser }) => {
  const ada = await boot(browser, "/games/never-have-i-ever.html", "Ada");
  const bea = await boot(browser, "/games/never-have-i-ever.html", "Bea");
  await ada.page.goto(BASE + "/games/never-have-i-ever.html?emulator=1&fast=1");
  await bea.page.goto(BASE + "/games/never-have-i-ever.html?emulator=1&fast=1");
  await ada.page.locator("#app").waitFor({ state: "visible" });
  await bea.page.locator("#app").waitFor({ state: "visible" });
  const code = await hostRoom(ada.page, "Ada");
  await joinRoom(bea.page, "Bea", code);
  await ada.page.locator("[data-len='5']").click();
  await ada.page.locator("#optin").check();
  await ada.page.locator("#start").click();
  await expect(ada.page.locator("#ihave")).toBeVisible();
  await expect(ada.page.locator("#locked")).toContainText("0 of 2 answered");
  await expect(ada.page.locator("#clockbar")).toBeAttached();
  await ada.page.locator("#ihave").click();
  await expect(ada.page.locator("#ihave")).toHaveAttribute("aria-pressed", "true");
  await expect(ada.page.locator("#locked")).toContainText("Locked in");
  await bea.page.locator("#ihave").click();
  await expect(ada.page.locator("#drinkhead")).toHaveText("Take a drink or pass", { timeout: 15000 });
  await expect(ada.page.locator("#havecount")).toContainText("2 of 2 said I HAVE");
  // both phones name the same storyteller, and Skip hides it on that phone only
  await expect.poll(async () => {
    const a = (await ada.page.locator("#storyline").innerText()).includes("You're up");
    const b = (await bea.page.locator("#storyline").innerText()).includes("You're up");
    return a !== b;
  }, { timeout: 10000 }).toBe(true);
  await ada.page.locator("#storyskip").click();
  await expect(ada.page.locator("#story")).toBeHidden();
  await expect(bea.page.locator("#story")).toBeVisible();
  // play to the end: the awards are cards with an emoji
  for (let r = 2; r <= 5; r++) {
    await ada.page.locator("#nextround").click();
    await expect(ada.page.locator("#ihave")).toBeVisible();
    await ada.page.locator("#ihave").click();
    await bea.page.locator("#never").click();
    await expect(ada.page.locator("#drinkhead")).toBeVisible({ timeout: 15000 });
  }
  await ada.page.locator("#nextround").click();
  await expect(ada.page.locator("#awards .nh-award").first()).toBeVisible({ timeout: 15000 });
  await expect(ada.page.locator("#awards .nh-award-emo").first()).not.toBeEmpty();
  await ada.context.close();
  await bea.context.close();
});

test("nhie most likely mode: pick it, vote for a person, results, story, awards", async ({ browser }) => {
  const ada = await boot(browser, "/games/never-have-i-ever.html", "Ada");
  const bea = await boot(browser, "/games/never-have-i-ever.html", "Bea");
  const cal = await boot(browser, "/games/never-have-i-ever.html", "Cal");
  for (const p of [ada, bea, cal]) {
    await p.page.goto(BASE + "/games/never-have-i-ever.html?emulator=1&fast=1");
    await p.page.locator("#app").waitFor({ state: "visible" });
  }
  const code = await hostRoom(ada.page, "Ada");
  await joinRoom(bea.page, "Bea", code);
  await joinRoom(cal.page, "Cal", code);
  // only the host picks the mode and its question pack
  await ada.page.locator("[data-mode='likely']").click();
  await expect(ada.page.locator("#likelypacks")).toBeVisible();
  await expect(bea.page.locator("#likelypacks")).toBeHidden();
  await ada.page.locator("[data-len='5']").click();
  await ada.page.locator("#optin").check();
  await expect(ada.page.locator("#lobbynote")).toContainText("Most likely");
  await ada.page.locator("#start").click();
  await expect(ada.page.locator("#voteopts button").first()).toBeVisible();
  // the deck is the moved Who's Most Likely prompts, and the kicker says so
  const deck = await ada.page.evaluate(() => window.__tpNhie.deck());
  deck.forEach((line) => expect(line).toMatch(/^Who's most likely to /));
  await expect(ada.page.locator("#kicker")).toHaveText("Who's most likely to");
  await expect(ada.page.locator("#badge")).toHaveText("Most likely");
  for (const p of [ada, bea, cal]) {
    await expect(p.page.locator("#ihave")).toBeHidden();
    await expect(p.page.locator("#voteopts button")).toHaveCount(2); // everyone but yourself
    const names = await p.page.locator("#voteopts button").allInnerTexts();
    expect(names).not.toContain(p.name);
  }
  for (let r = 1; r <= 5; r++) {
    if (r > 1) { await ada.page.locator("#nextround").click(); await expect(ada.page.locator("#voteopts button").first()).toBeVisible(); }
    await ada.page.locator("#voteopts button", { hasText: "Bea" }).click();
    await cal.page.locator("#voteopts button", { hasText: "Bea" }).click();
    await bea.page.locator("#voteopts button", { hasText: "Cal" }).click();
    await expect(ada.page.locator("#drinkhead")).toHaveText("Take a drink or pass", { timeout: 15000 });
    await expect(ada.page.locator("#havecount")).toContainText("2 of 3 votes");
    await expect(ada.page.locator("#havelist")).toContainText("Bea · 2 votes");
    await expect(ada.page.locator("#havelist")).not.toContainText("Cal");
    if (r === 1) {
      await expect(bea.page.locator("#storyline")).toContainText("You're up: explain that vote");
      await expect(ada.page.locator("#storyline")).toContainText("Bea, explain that vote");
    }
  }
  await ada.page.locator("#nextround").click();
  await expect(ada.page.locator("#awards .nh-award").first()).toContainText("Most mentioned", { timeout: 15000 });
  await expect(ada.page.locator("#awards")).toContainText("Bea");
  await expect(ada.page.locator("#finalelede")).toContainText("Votes are stories");
  for (const p of [ada, bea, cal]) await p.context.close();
});

test("lobby removal works and baseline rules still reject a host claim", async ({ browser }) => {
  const ada = await boot(browser, "/games/never-have-i-ever.html", "Ada");
  const bea = await boot(browser, "/games/never-have-i-ever.html", "Bea");
  const code = await hostRoom(ada.page, "Ada");
  await joinRoom(bea.page, "Bea", code);
  await expect(ada.page.locator("#plist")).toContainText("Bea");
  await ada.page.locator("#rmmenubtn").click(); // Remove moved into the Menu
  await ada.page.getByRole("button", { name: "Remove Bea" }).click();
  await expect(ada.page.locator("#plist")).not.toContainText("Bea");
  const ns = "tipsyplay-f3c95-default-rtdb";
  const token = await bea.page.evaluate(async () => {
    const authMod = await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js");
    return authMod.getAuth().currentUser.getIdToken();
  });
  const beaUid = await bea.page.evaluate(() => window.__tpNhie.uid());
  const read = await bea.page.request.get("http://127.0.0.1:9000/rooms/" + code + "/meta.json?ns=" + ns + "&auth=" + encodeURIComponent(token));
  expect(read.ok(), await read.text()).toBe(true);
  const meta = await read.json();
  meta.hostUid = beaUid;
  const claim = await bea.page.request.put("http://127.0.0.1:9000/rooms/" + code + "/meta.json?ns=" + ns + "&auth=" + encodeURIComponent(token), {
    data: meta,
    headers: { "content-type": "application/json" }
  });
  expect(claim.ok()).toBe(false);
  expect(await claim.text()).toMatch(/permission|denied/i);
  const hostToken = await ada.page.evaluate(async () => {
    const authMod = await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js");
    return authMod.getAuth().currentUser.getIdToken();
  });
  const hostUid = await ada.page.evaluate(() => window.__tpNhie.uid());
  const made = await ada.page.request.put("http://127.0.0.1:9000/rooms/" + code + "/nhie/react/clap01.json?ns=" + ns + "&auth=" + encodeURIComponent(hostToken), {
    data: { e: "clap", u: hostUid },
    headers: { "content-type": "application/json" }
  });
  expect(made.ok(), await made.text()).toBe(true);
  const wipe = await ada.page.request.delete("http://127.0.0.1:9000/rooms/" + code + "/nhie/react/clap01.json?ns=" + ns + "&auth=" + encodeURIComponent(hostToken));
  expect(wipe.ok()).toBe(false);
  expect(await wipe.text()).toMatch(/permission|denied/i);
  await ada.context.close();
  await bea.context.close();
});

test("narrow pages do not scroll sideways", async ({ browser }) => {
  const pages = ["/", "/games/", "/blog/", "/spots/canada-cities/halifax.html", "/games/kings-cup.html"];
  for (const width of [320, 375, 390]) {
    const context = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width, height: 700 }
    });
    await context.route(/googletagmanager|google-analytics|analytics\.google/, (route) => route.abort());
    const page = await context.newPage();
    await page.addInitScript(() => { localStorage.setItem("tp_age_ok", "yes"); localStorage.setItem("tp_sound", "off"); });
    for (const path of pages) {
      await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
      const box = await overflow(page);
      expect(box.over, path + " @" + width).toBe(false);
      if (width === 320 && path === "/") await shot(page, "home-320");
      if (width === 375 && path === "/games/") await shot(page, "games-index-375");
      if (width === 390 && path === "/blog/") await shot(page, "blog-index-390");
    }
    await context.close();
  }
});
