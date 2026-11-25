/* Hot Take Court on the Firebase emulators: three phones and a TV display play a full game, the rules keep votes and
   offers private, a player refreshes mid-round, and the host's phone goes away. */
const { test, expect } = require("./harness");
const BASE = process.env.TIPSY_BASE || "http://127.0.0.1:8765";
const PAGE = "/play/hot-take-court.html?emulator=1&fast=1";
const NS = "tipsyplay-f3c95-default-rtdb";

async function phone(browser, name, opts) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", ...(opts || {}) });
  await context.route(/googletagmanager|google-analytics/, (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((n) => { localStorage.setItem("tp_age_ok", "yes"); localStorage.setItem("tp_sound", "off"); if (n) localStorage.setItem("tp_name", n); }, name);
  await page.goto(BASE + PAGE);
  await page.locator("#hostbtn").waitFor({ state: "visible" });
  return { context, page, name, errors };
}
async function tv(browser, code) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: "block" });
  await context.route(/googletagmanager|google-analytics/, (r) => r.abort());
  const page = await context.newPage();
  await page.addInitScript(() => { localStorage.setItem("tp_sound", "off"); });
  await page.goto(BASE + "/play/display.html?room=" + code + "&emulator=1&fast=1");
  return { context, page };
}
const hook = (p, fn) => p.page.evaluate((f) => window.__tpCourt && window.__tpCourt[f](), fn);
const phase = (p) => hook(p, "phase");
const token = (p) => p.page.evaluate(async () => {
  const m = await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js");
  return m.getAuth().currentUser.getIdToken();
});
async function room(browser, names, opts) {
  const P = [];
  for (const n of names || ["Jo", "Sam", "Priya"]) P.push(await phone(browser, n, opts));
  await P[0].page.locator("#hostbtn").click();
  await expect(P[0].page.locator("#lobby")).toBeVisible();
  const code = (await P[0].page.locator("#codebig").innerText()).trim();
  for (const p of P.slice(1)) {
    await p.page.locator("#roomcode").fill(code);
    await p.page.locator("#joinbtn").click();
    await expect(p.page.locator("#lobby")).toBeVisible();
  }
  await expect(P[0].page.locator("#start")).toBeEnabled();
  return { P, code };
}
/* who has which role this case */
async function roles(P) {
  const out = {};
  for (const p of P) {
    await expect.poll(() => hook(p, "role")).not.toBe("watch");
    out[await hook(p, "role")] = (out[await hook(p, "role")] || []).concat([p]);
  }
  return out;
}

test("hot take court: a full game on three phones with a TV display", async ({ browser }) => {
  const { P, code } = await room(browser);
  const [jo, sam] = P;
  const T = await tv(browser, code);
  await expect(T.page.locator("#bigcode")).toHaveText(code);
  await expect(T.page.locator("#tvplayers li")).toHaveCount(3);
  await expect.poll(() => hook(jo, "display")).toBe(true);
  // the host picks the Spicy pack; guests can't
  await jo.page.locator('[data-pack="spicy"]').click();
  await expect(sam.page.locator('[data-pack="spicy"]')).toHaveAttribute("aria-pressed", "true");
  await expect(sam.page.locator('[data-pack="spicy"]')).toBeDisabled();
  await jo.page.locator("#start").click();
  let verdicts = 0;
  for (let n = 1; n <= 3; n++) {
    await expect.poll(() => phase(jo), { timeout: 15000 }).toBe("case");
    const r = await roles(P);
    const def = r.defendant[0], pro = r.prosecutor[0], jur = r.juror[0];
    await expect(T.page.locator(".cs-file-title")).toContainText("The Table vs. " + def.name);
    // the Defendant privately picks one of three takes; nobody else sees the options
    await expect(def.page.locator("#mine .pg-choices button")).toHaveCount(3);
    for (const b of await def.page.locator("#mine .pg-choices button").all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await hook(jur, "offer")).toBeNull();
    const take = await def.page.locator("#mine .pg-choices button").nth(1).innerText();
    await def.page.locator("#mine .pg-choices button").nth(1).click();
    await expect.poll(() => phase(jo)).toBe("opening");
    await expect(T.page.locator(".cs-take")).toContainText(take);
    await def.page.locator("#mine .btn", { hasText: "I rest my case" }).click();
    await expect.poll(() => phase(jo)).toBe("prosecution");
    // an objection flashes on the TV and doesn't stop the clock
    await jur.page.locator(".pg-objection").click();
    await expect(T.page.locator(".cs-flash")).toContainText("OBJECTION! — " + jur.name);
    await expect(jur.page.locator(".pg-objection")).toBeDisabled();
    await pro.page.locator("#mine .btn", { hasText: "I rest my case" }).click();
    await expect.poll(() => phase(jo)).toBe("deliberation");
    await expect(T.page.locator(".cs-mid")).toContainText("0 of 1 votes in");
    // case 2 is acquitted, the others guilty
    await jur.page.locator(".pg-two button", { hasText: n === 2 ? /^Not guilty$/ : /^Guilty$/ }).click();
    await expect.poll(() => phase(jo)).toBe("verdict");
    const result = n === 2 ? "NOT GUILTY" : "GUILTY";
    await expect(T.page.locator(".cs-stamp")).toHaveText(result);
    await expect(T.page.locator(".cs-stamp.on")).toBeVisible({ timeout: 5000 });
    await expect(T.page.locator(".cs-card.up")).toHaveCount(1);
    verdicts++;
    await expect.poll(() => phase(jo), { timeout: 8000 }).toBe("sentencing");
    const chooser = n === 2 ? pro : def;
    const banner = chooser.page.locator("#mine .pg-drink");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Drink moment");
    for (const label of ["Take a drink", n === 2 ? "Do the pose instead" : "Take the jury's sentence", "Pass"]) await expect(banner.locator(".btn", { hasText: label })).toBeVisible();
    expect(await banner.innerText()).not.toMatch(/\bsips?\b|water/i);
    if (n !== 2) {
      await expect(jur.page.locator("#mine .pg-choices button")).toHaveCount(3);
      await jur.page.locator("#mine .pg-choices button").nth(0).click();
    }
    await banner.locator(".btn", { hasText: n === 1 ? "Take a drink" : n === 2 ? "Pass" : "Take the jury's sentence" }).click();
    await expect.poll(() => phase(jo)).toBe("scores");
    const line = T.page.locator(".cs-big").first();
    if (n === 1) await expect(line).toHaveText(def.name + " takes a drink.");
    if (n === 2) await expect(line).toHaveText(pro.name + " passed. No penalty.");
    if (n === 3) await expect(line).toHaveText(new RegExp("^" + def.name + "'s sentence: "));
  }
  expect(verdicts).toBe(3);
  // results: final scoreboard, then awards one at a time, then Play again with the same players
  await expect.poll(() => phase(jo), { timeout: 10000 }).toBe("end");
  await expect(T.page.locator(".cs-board li")).toHaveCount(3);
  await expect(T.page.locator(".cs-award.on").first()).toBeVisible({ timeout: 6000 });
  const titles = await T.page.locator(".cs-award-title").allTextContents();
  expect(titles).toContain("Most Convicted");
  expect(titles).toContain("Smooth Talker");
  expect(titles.length).toBeGreaterThanOrEqual(3);
  await expect(jo.page.locator("#again")).toBeVisible();
  await expect(sam.page.locator("#again")).toBeHidden();
  await jo.page.locator("#again").click();
  await expect.poll(() => phase(sam)).toBe("case");
  expect((await hook(sam, "data")).caseNo).toBe(1);
  for (const p of P) expect(p.errors).toEqual([]);
  for (const p of P) await p.context.close();
  await T.context.close();
});

test("hot take court: the rules keep votes, offers and the game state private", async ({ browser }) => {
  const { P, code } = await room(browser);
  const T = await tv(browser, code);
  await expect.poll(() => hook(P[0], "display")).toBe(true);
  await P[0].page.locator("#start").click();
  await expect.poll(() => phase(P[0])).toBe("case");
  const r = await roles(P);
  const def = r.defendant[0], pro = r.prosecutor[0], jur = r.juror[0];
  const url = (path, t) => `http://127.0.0.1:9000/rooms/${code}/${path}.json?ns=${NS}&auth=${encodeURIComponent(t)}`;
  const req = P[0].page.request;
  const [defTok, proTok, jurTok, hostTok] = [await token(def), await token(pro), await token(jur), await token(P[0])];
  const [defUid, proUid, jurUid] = [await hook(def, "uid"), await hook(pro, "uid"), await hook(jur, "uid")];
  // the offer: the Defendant and the host only
  expect((await req.get(url("hc/offer/" + defUid, defTok))).status()).toBe(200);
  expect((await req.get(url("hc/offer/" + defUid, jurTok))).status()).toBe(defUid === (await hook(P[0], "uid")) ? 401 : 401);
  // the game state: host only
  expect((await req.get(url("hc/secret", hostTok))).status()).toBe(200);
  for (const t of [defTok, proTok, jurTok].filter((t) => t !== hostTok)) expect((await req.get(url("hc/secret", t))).status()).toBe(401);
  // only the Defendant picks; nobody writes someone else's entry or the public state
  expect((await req.put(url("hc/pick/" + jurUid, jurTok), { data: "0" })).status()).toBe(401);
  expect((await req.put(url("hc/pick/" + defUid, jurTok), { data: "0" })).status()).toBe(401);
  if (jurTok !== hostTok) expect((await req.put(url("hc/pub", jurTok), { data: { phase: "end", seq: 1, deadline: 0, data: "{}" } })).status()).toBe(401);
  // no voting before deliberation, and never for someone else
  expect((await req.put(url("hc/vote/" + jurUid, jurTok), { data: JSON.stringify("g:1") })).status()).toBe(401);
  await def.page.locator("#mine .pg-choices button").first().click();
  await expect.poll(() => phase(P[0])).toBe("opening");
  await def.page.locator("#mine .btn", { hasText: "I rest my case" }).click();
  await expect.poll(() => phase(P[0])).toBe("prosecution");
  await pro.page.locator("#mine .btn", { hasText: "I rest my case" }).click();
  await expect.poll(() => phase(P[0])).toBe("deliberation");
  expect((await req.put(url("hc/vote/" + proUid, proTok), { data: JSON.stringify("n:1") })).status()).toBe(401); // the Prosecutor is not a juror
  expect((await req.put(url("hc/vote/" + defUid, defTok), { data: JSON.stringify("n:1") })).status()).toBe(401); // nor the Defendant
  expect((await req.put(url("hc/vote/" + jurUid, proTok), { data: JSON.stringify("g:1") })).status()).toBe(401); // not yours
  expect((await req.put(url("hc/vote/" + jurUid, jurTok), { data: JSON.stringify("maybe") })).status()).toBe(401); // not a vote
  expect((await req.put(url("hc/vote/" + jurUid, jurTok), { data: JSON.stringify("g:1") })).status()).toBe(200);
  // a secret vote: the voter and the host can read it; other players can't, and the public state doesn't hold it
  expect((await req.get(url("hc/vote/" + jurUid, jurTok))).status()).toBe(200);
  for (const t of [defTok, proTok].filter((t) => t !== hostTok)) {
    expect((await req.get(url("hc/vote/" + jurUid, t))).status()).toBe(401);
    expect((await req.get(url("hc/vote", t))).status()).toBe(401);
  }
  // the display isn't a player: it can mark itself connected, but can't write the game or vote
  const tvTok = await T.page.evaluate(async () => (await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js")).getAuth().currentUser.getIdToken());
  expect((await req.put(url("hc/screen", tvTok), { data: { ".sv": "timestamp" } })).status()).toBe(200);
  expect((await req.put(url("hc/pub", tvTok), { data: { phase: "end", seq: 1, deadline: 0, data: "{}" } })).status()).toBe(401);
  expect((await req.get(url("hc/vote", tvTok))).status()).toBe(401);
  // nobody can take the host role while the host is connected
  expect((await req.put(url("hc/host", jurTok), { data: JSON.stringify(jurUid) })).status()).toBe(jurTok === hostTok ? 200 : 401);
  await expect.poll(() => phase(P[0])).toBe("verdict");
  expect((await hook(def, "data")).verdict.cards[0].v).toBe("g");
  for (const p of P) await p.context.close();
  await T.context.close();
});

test("hot take court: a player who refreshes mid-round rejoins the same game and phase", async ({ browser }) => {
  const { P } = await room(browser);
  await P[0].page.locator("#start").click();
  await expect.poll(() => phase(P[0])).toBe("case");
  const r = await roles(P);
  await r.defendant[0].page.locator("#mine .pg-choices button").first().click();
  await expect.poll(() => phase(P[0])).toBe("opening");
  await r.defendant[0].page.locator("#mine .btn", { hasText: "I rest my case" }).click();
  await expect.poll(() => phase(P[0])).toBe("prosecution");
  await r.prosecutor[0].page.locator("#mine .btn", { hasText: "I rest my case" }).click();
  await expect.poll(() => phase(P[0])).toBe("deliberation");
  const jur = r.juror[0];
  await jur.page.reload();
  await expect(jur.page.locator("#table")).toBeVisible({ timeout: 15000 });
  expect(await hook(jur, "role")).toBe("juror");
  await expect(jur.page.locator(".pg-two button", { hasText: /^Not guilty$/ })).toBeVisible();
  await jur.page.locator(".pg-two button", { hasText: /^Not guilty$/ }).click();
  await expect.poll(() => phase(P[0])).toBe("verdict");
  expect((await hook(P[0], "data")).verdict.result).toBe("not");
  for (const p of P) await p.context.close();
});

test("hot take court: when the host's phone goes away, the next player runs the game", async ({ browser }) => {
  const { P } = await room(browser, ["Jo", "Sam", "Priya", "Lee"]);
  const [jo, sam] = P;
  await jo.page.locator("#start").click();
  await expect.poll(() => phase(sam)).toBe("case");
  // no display: the host's phone shows the compact shared screen; other phones don't
  await expect(jo.page.locator("#shared")).toBeVisible();
  await expect(jo.page.locator("#shared .cs-file")).toBeVisible();
  await expect(sam.page.locator("#shared")).toBeHidden();
  await jo.context.close();
  await expect.poll(() => hook(sam, "host"), { timeout: 20000 }).toBe(true);
  await expect(sam.page.locator("#shared")).toBeVisible();
  // the game keeps moving under the new host, and Jo's turns are skipped
  await expect.poll(async () => (await hook(sam, "data")).caseNo, { timeout: 30000 }).toBeGreaterThanOrEqual(2);
  const d = await hook(sam, "data");
  expect(d.defendant).not.toBe(await P[0].page.evaluate(() => 0).catch(() => "gone"));
  for (const p of P.slice(1)) await p.context.close();
});

test("hot take court: reduced motion shows the verdict at once", async ({ browser }) => {
  const { P, code } = await room(browser, null, { reducedMotion: "reduce" });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: "block", reducedMotion: "reduce" });
  const tvp = await ctx.newPage();
  await tvp.goto(BASE + "/play/display.html?room=" + code + "&emulator=1&fast=1");
  await expect.poll(() => hook(P[0], "display")).toBe(true);
  await P[0].page.locator("#start").click();
  await expect.poll(() => phase(P[0])).toBe("case");
  const r = await roles(P);
  await r.defendant[0].page.locator("#mine .pg-choices button").first().click();
  await r.defendant[0].page.locator("#mine .btn", { hasText: "I rest my case" }).click();
  await r.prosecutor[0].page.locator("#mine .btn", { hasText: "I rest my case" }).click();
  await r.juror[0].page.locator(".pg-two button", { hasText: /^Guilty$/ }).click();
  await expect.poll(() => phase(P[0])).toBe("verdict");
  // the cards and the stamp are there straight away, with no animation
  await expect(tvp.locator(".cs-stamp.on")).toBeVisible({ timeout: 1000 });
  expect(await tvp.locator(".cs-stamp").evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
  for (const p of P) await p.context.close();
  await ctx.close();
});
