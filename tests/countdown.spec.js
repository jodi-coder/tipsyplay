/* Category Countdown on the Firebase emulators: three phones and a TV display play Spotlight and Hot Potato, the rules
   keep challenge votes private, a player refreshes mid-round, and the host's phone goes away. */
const { test, expect } = require("./harness");
const BASE = process.env.TIPSY_BASE || "http://127.0.0.1:8765";
const PAGE = "/play/category-countdown.html?emulator=1&fast=1";
const NS = "tipsyplay-f3c95-default-rtdb";

async function phone(browser, name) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await context.route(/googletagmanager|google-analytics/, (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((n) => { localStorage.setItem("tp_age_ok", "yes"); localStorage.setItem("tp_sound", "off"); localStorage.setItem("tp_name", n); }, name);
  await page.goto(BASE + PAGE);
  await page.locator("#hostbtn").waitFor({ state: "visible" });
  return { context, page, name, errors };
}
async function tv(browser, code) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: "block" });
  await context.route(/googletagmanager|google-analytics/, (r) => r.abort());
  const page = await context.newPage();
  await page.goto(BASE + "/play/display.html?room=" + code + "&emulator=1&fast=1");
  return { context, page };
}
const hook = (p, fn) => p.page.evaluate((f) => window.__tpCountdown && window.__tpCountdown[f](), fn);
const phase = (p) => hook(p, "phase");
const data = (p) => hook(p, "data");
const token = (p) => p.page.evaluate(async () => (await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js")).getAuth().currentUser.getIdToken());
async function room(browser, names, mode) {
  const P = [];
  for (const n of names || ["Jo", "Sam", "Priya"]) P.push(await phone(browser, n));
  await P[0].page.locator("#hostbtn").click();
  await expect(P[0].page.locator("#lobby")).toBeVisible();
  const code = (await P[0].page.locator("#codebig").innerText()).trim();
  for (const p of P.slice(1)) {
    await p.page.locator("#roomcode").fill(code);
    await p.page.locator("#joinbtn").click();
    await expect(p.page.locator("#lobby")).toBeVisible();
  }
  if (mode === "potato") { await P[0].page.locator('[data-mode="potato"]').click(); await expect(P[1].page.locator('[data-mode="potato"]')).toHaveAttribute("aria-pressed", "true"); }
  await expect(P[0].page.locator("#start")).toBeEnabled();
  return { P, code };
}
async function who(P, uid) { for (const p of P) if ((await hook(p, "uid")) === uid) return p; return null; }
async function answer(p, text) { await p.page.locator("#ans").fill(text); await p.page.locator("#ans").press("Enter"); }

test("category countdown: a full Spotlight game with a TV display", async ({ browser }) => {
  const { P, code } = await room(browser);
  const [jo, sam] = P;
  const T = await tv(browser, code);
  await expect(T.page.locator("#bigcode")).toHaveText(code);
  await expect.poll(() => hook(jo, "display")).toBe(true);
  await jo.page.locator("#start").click();
  for (let r = 1; r <= 3; r++) {
    await expect.poll(() => phase(jo), { timeout: 15000 }).toBe("intro");
    await expect(T.page.locator(".cc-count")).toBeVisible();
    await expect.poll(() => phase(jo)).toBe("answer");
    const d = await data(jo);
    const actor = await who(P, d.actor), other = P.find((p) => p !== actor);
    await expect(T.page.locator(".cc-cat-text")).toHaveText(d.cat.text);
    // answers pop onto the TV as they land; repeats are caught on the phone
    await answer(actor, "First thing");
    await answer(actor, "second thing");
    await answer(actor, "FIRST things!");
    await expect(actor.page.locator(".pg-note")).toContainText("Already said");
    await answer(actor, "Third thing");
    await expect(T.page.locator(".cc-tile")).toHaveCount(3);
    await expect(other.page.locator(".pg-tiles button")).toHaveCount(3);
    expect((await actor.page.locator("#ans").boundingBox()).height).toBeGreaterThanOrEqual(44);
    // round 2: someone challenges an answer; it goes to a thumbs vote and gets thrown out
    if (r === 2) {
      await other.page.locator(".pg-tiles button", { hasText: "second thing" }).click();
      await expect(T.page.locator(".cc-tile.flag")).toHaveCount(1);
    }
    await jo.page.locator("#skipbtn").click();
    if (r === 2) {
      await expect.poll(() => phase(jo)).toBe("cvote");
      for (const p of P) if (p !== actor) await p.page.locator(".pg-vote button", { hasText: "Out" }).click();
      await expect(actor.page.locator(".pg-vote button")).toHaveCount(0);
    }
    await expect.poll(() => phase(jo)).toBe("result");
    const res = await data(jo);
    expect(res.outcome.count).toBe(r === 2 ? 2 : 3);
    const hit = res.outcome.count >= res.cat.target;
    await expect(T.page.locator(".cs-stamp")).toHaveText(hit ? "TARGET HIT!" : "MISSED IT");
    // the drink moment: who drinks and why, with the alternative and Pass on the same screen
    const owing = hit ? P.filter((p) => p !== actor) : [actor];
    for (const p of owing) {
      const banner = p.page.locator(".pg-drink");
      await expect(banner).toBeVisible();
      for (const label of ["Take a drink", "Do the alternative", "Pass"]) await expect(banner.locator(".btn", { hasText: label })).toBeVisible();
      expect(await banner.innerText()).not.toMatch(/\bsips?\b|water/i);
    }
    await owing[0].page.locator(".pg-drink .btn", { hasText: "Pass" }).click();
    await expect(T.page.locator(".cc-drinks")).toContainText(owing[0].name + ": passed");
    await jo.page.locator("#skipbtn").click();
  }
  await expect.poll(() => phase(jo), { timeout: 15000 }).toBe("end");
  await expect(T.page.locator(".cs-board li")).toHaveCount(3);
  await expect(T.page.locator(".cs-award.on").first()).toBeVisible({ timeout: 6000 });
  const titles = await T.page.locator(".cs-award-title").allTextContents();
  expect(titles).toContain("Category Royalty");
  expect(titles).toContain("Most Challenged");
  expect(titles).toContain("Fastest Mouth");
  await expect(sam.page.locator("#again")).toBeHidden();
  await jo.page.locator("#again").click();
  await expect.poll(() => phase(sam)).toBe("intro");
  for (const p of P) expect(p.errors).toEqual([]);
  for (const p of P) await p.context.close();
  await T.context.close();
});

test("category countdown: Hot Potato knocks out a repeat and a rejected answer, and the last one standing wins", async ({ browser }) => {
  const { P, code } = await room(browser, ["Jo", "Sam", "Priya", "Lee"], "potato");
  const T = await tv(browser, code);
  await P[0].page.locator("#start").click();
  await expect.poll(() => phase(P[0])).toBe("turn");
  const turnOf = async () => who(P, (await data(P[0])).actor);
  // 1: a good answer, nobody challenges
  let a = await turnOf(); await answer(a, "apple");
  await expect.poll(() => phase(P[0])).toBe("window");
  await expect(T.page.locator(".cc-tile")).toHaveCount(1);
  await expect.poll(() => phase(P[0]), { timeout: 8000 }).toBe("turn");
  // 2: a repeat knocks the player out at once
  a = await turnOf(); await answer(a, "Apples");
  await expect.poll(async () => (await data(P[0])).out.length).toBe(1);
  expect((await data(P[0])).out[0].why).toBe("repeat");
  await expect(T.page.locator(".cs-flash")).toContainText(a.name + " is out");
  await expect(a.page.locator(".pg-drink")).toBeVisible();
  await a.page.locator(".pg-drink .btn", { hasText: "Do the alternative" }).click();
  // 3: a challenged answer is voted out
  await expect.poll(() => phase(P[0])).toBe("turn");
  const b = await turnOf(); await answer(b, "spaceship");
  await expect.poll(() => phase(P[0])).toBe("window");
  const challenger = P.find((p) => p !== b);
  await challenger.page.locator(".pg-objection", { hasText: "Challenge!" }).click();
  await expect.poll(() => phase(P[0])).toBe("cvote");
  for (const p of P) if (p !== b) await p.page.locator(".pg-vote button", { hasText: "Out" }).click();
  await expect.poll(async () => (await data(P[0])).out.length).toBe(2);
  expect((await data(P[0])).out[1].why).toBe("rejected");
  // 4: the next player runs out of time
  await expect.poll(() => phase(P[0])).toBe("turn");
  await expect.poll(() => phase(P[0]), { timeout: 12000 }).toBe("result");
  const res = await data(P[0]);
  expect(res.out.map((o) => o.why)).toEqual(["repeat", "rejected", "time"]);
  expect(res.scores[res.outcome.winner]).toBe(3);
  expect(res.scores[res.outcome.second]).toBe(1);
  await expect(T.page.locator(".cs-stamp")).toHaveText(await res.names[res.outcome.winner]);
  for (const p of P) expect(p.errors).toEqual([]);
  for (const p of P) await p.context.close();
  await T.context.close();
});

test("category countdown: rules keep challenge votes private and players on their own paths", async ({ browser }) => {
  const { P, code } = await room(browser);
  await P[0].page.locator("#start").click();
  await expect.poll(() => phase(P[0])).toBe("answer");
  const d = await data(P[0]);
  const actor = await who(P, d.actor), others = P.filter((p) => p !== actor);
  const url = (path, t) => `http://127.0.0.1:9000/rooms/${code}/${path}.json?ns=${NS}&auth=${encodeURIComponent(t)}`;
  const req = P[0].page.request;
  const aTok = await token(actor), oTok = await token(others[0]), o2Tok = await token(others[1]);
  const aUid = await hook(actor, "uid"), oUid = await hook(others[0], "uid"), o2Uid = await hook(others[1], "uid");
  // only the player in the spotlight answers, only into their own list
  expect((await req.put(url("cc/ans/" + oUid + "/0", oTok), { data: JSON.stringify("sneaky") })).status()).toBe(401);
  expect((await req.put(url("cc/ans/" + aUid + "/0", oTok), { data: JSON.stringify("sneaky") })).status()).toBe(401);
  expect((await req.put(url("cc/ans/" + aUid + "/0", aTok), { data: JSON.stringify("Lettuce") })).status()).toBe(200);
  // the player in the spotlight can't challenge their own answers; others can only write their own challenges
  expect((await req.put(url("cc/chal/" + aUid, aTok), { data: JSON.stringify("a0") })).status()).toBe(401);
  expect((await req.put(url("cc/chal/" + o2Uid, oTok), { data: JSON.stringify("a0") })).status()).toBe(401);
  await expect.poll(async () => (await data(P[0])).answers.length).toBe(1);
  await others[0].page.locator(".pg-tiles button", { hasText: "Lettuce" }).click();
  // no voting before the vote
  expect((await req.put(url("cc/cvote/" + oUid, oTok), { data: JSON.stringify("a0:d") })).status()).toBe(401);
  if (await hook(P[0], "host")) await P[0].page.locator("#skipbtn").click();
  await expect.poll(() => phase(P[0])).toBe("cvote");
  expect((await req.put(url("cc/cvote/" + aUid, aTok), { data: JSON.stringify("a0:u") })).status()).toBe(401); // the answerer doesn't vote
  expect((await req.put(url("cc/cvote/" + o2Uid, oTok), { data: JSON.stringify("a0:u") })).status()).toBe(401); // not your vote
  expect((await req.put(url("cc/cvote/" + oUid, oTok), { data: JSON.stringify("a0:d") })).status()).toBe(200);
  // a challenge vote is readable by the voter and the host only
  const hostTok = await token(P[0]);
  expect((await req.get(url("cc/cvote/" + oUid, oTok))).status()).toBe(200);
  for (const t of [aTok, o2Tok].filter((t) => t !== hostTok)) {
    expect((await req.get(url("cc/cvote/" + oUid, t))).status()).toBe(401);
    expect((await req.get(url("cc/cvote", t))).status()).toBe(401);
  }
  expect((await req.get(url("cc/secret", hostTok))).status()).toBe(200);
  for (const t of [aTok, oTok, o2Tok].filter((t) => t !== hostTok)) expect((await req.get(url("cc/secret", t))).status()).toBe(401);
  for (const p of P) await p.context.close();
});

test("category countdown: the player in the spotlight refreshes and keeps answering", async ({ browser }) => {
  const { P } = await room(browser);
  await P[0].page.locator("#start").click();
  await expect.poll(() => phase(P[0])).toBe("answer");
  const actor = await who(P, (await data(P[0])).actor);
  await answer(actor, "Before refresh");
  await expect.poll(async () => (await data(P[0])).answers.length).toBe(1);
  await actor.page.reload();
  await expect(actor.page.locator("#ans")).toBeVisible({ timeout: 15000 });
  await answer(actor, "After refresh");
  await expect.poll(async () => (await data(P[0])).answers.map((a) => a.text)).toEqual(["Before refresh", "After refresh"]);
  for (const p of P) await p.context.close();
});

test("category countdown: when the host's phone goes away, the next player runs the game", async ({ browser }) => {
  const { P } = await room(browser, ["Jo", "Sam", "Priya", "Lee"]);
  const [jo, sam] = P;
  await jo.page.locator("#start").click();
  await expect.poll(() => phase(sam)).toBe("answer");
  await expect(jo.page.locator("#shared .cc-cat")).toBeVisible();
  await jo.context.close();
  await expect.poll(() => hook(sam, "host"), { timeout: 20000 }).toBe(true);
  await expect.poll(async () => (await data(sam)).round, { timeout: 40000 }).toBeGreaterThanOrEqual(2);
  for (const p of P.slice(1)) await p.context.close();
});
