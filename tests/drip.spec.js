/* Slow Drip in real browsers against the Firebase emulators: a full round on three phones (a wrong solve, then a
   correct one), the database rules that keep the phrase and the bets private, the host handoff, and practice mode. */
const { test, expect } = require("@playwright/test");
const BASE = process.env.TIPSY_BASE || "http://127.0.0.1:8765";
const PAGE = "/play/slow-drip.html?emulator=1";
const FAST = PAGE + "&fast=1";
const NS = "tipsyplay-f3c95-default-rtdb";

async function phone(browser, name, path) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/googletagmanager|google-analytics/, (r) => r.abort());
  const page = await context.newPage();
  page.on("pageerror", (e) => { throw e; });
  await page.addInitScript((n) => { localStorage.setItem("tp_age_ok", "yes"); localStorage.setItem("tp_sound", "off"); localStorage.setItem("tp_name", n); }, name);
  await page.goto(BASE + (path || FAST));
  await page.locator("#hostbtn").waitFor({ state: "visible" });
  return { context, page, name };
}
const hook = (p, fn) => p.page.evaluate((f) => window.__tpDrip && window.__tpDrip[f](), fn);
const phase = (p) => hook(p, "phase");
const token = (p) => p.page.evaluate(async () => {
  const m = await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js");
  return m.getAuth().currentUser.getIdToken();
});
async function room(browser, path) {
  const P = [await phone(browser, "Jo", path), await phone(browser, "Sam", path), await phone(browser, "Priya", path)];
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

test("slow drip: a full round on three phones, a wrong solve then a correct one", async ({ browser }) => {
  const { P } = await room(browser);
  const [jo, sam, priya] = P;
  await expect(jo.page.locator(".na")).toContainText("passing is always fine");
  await expect(sam.page.locator("#start")).toBeHidden(); // only the host starts
  await jo.page.locator("#start").click();

  // 1. drip: every phone shows the blanks, the category and a countdown; only the host's phone holds the phrase
  for (const p of P) {
    await expect(p.page.locator("#dripbox")).toBeVisible();
    await expect(p.page.locator("#dripnum")).toHaveText(/^[0-9]+$/);
    await expect(p.page.locator("#catline")).not.toBeEmpty();
    expect(await p.page.locator("#board .sd-tile.blank").count()).toBeGreaterThan(3);
  }
  const phrase = await hook(jo, "phrase");
  expect(phrase.length).toBeGreaterThan(9);
  expect(await hook(sam, "phrase")).toBeNull();
  expect(JSON.stringify(await hook(sam, "data"))).not.toContain(phrase);
  expect((await sam.page.locator("#solve").boundingBox()).height).toBeGreaterThanOrEqual(44);

  // 2. buzz: Sam taps SOLVE and everyone sees who is solving
  await sam.page.locator("#solve").click();
  await expect.poll(() => phase(jo)).toBe("bet");
  await expect(jo.page.locator("#bethead")).toHaveText("Sam is solving.");
  await expect(priya.page.locator("#bethead")).toHaveText("Sam is solving.");
  // 3. betting: the solver waits and cannot type; Jo bets SOLVE; Priya misses the window
  await expect(sam.page.locator("#bethead")).toHaveText("Waiting for bets…");
  await expect(sam.page.locator("#bets")).toBeHidden();
  await expect(sam.page.locator("#guessform")).toBeHidden();
  for (const id of ["#betsolve", "#betfail", "#betpass"]) expect((await jo.page.locator(id).boundingBox()).height).toBeGreaterThanOrEqual(44);
  await jo.page.locator("#betsolve").click();
  await expect(jo.page.locator("#betnote")).toContainText("Locked in: SOLVE");
  await expect(jo.page.locator("#betsolve")).toHaveAttribute("aria-pressed", "true");
  // bets stay hidden: nothing public says how Jo bet
  expect(JSON.stringify(await hook(priya, "data"))).not.toMatch(/"bets"/);
  // 4. hot seat: Sam types a wrong answer
  await expect.poll(() => phase(jo), { timeout: 10000 }).toBe("seat");
  await expect(priya.page.locator("#seatnote")).toHaveText("No bet in time: counted as FAIL.");
  await expect(jo.page.locator("#seatnote")).toHaveText("You bet SOLVE.");
  await expect(jo.page.locator("#seathead")).toHaveText("Sam is in the hot seat");
  await expect(sam.page.locator("#guessform")).toBeVisible();
  await sam.page.locator("#guess").fill("definitely not it");
  await sam.page.locator("#sendguess").click();
  // 5. payout: the result and every bet together, who drinks and why, with the alternative on the same screen
  for (const p of P) {
    const box = p.page.locator("#payoutbox");
    await expect(box).toBeVisible();
    await expect(box).toContainText("Wrong!");
    await expect(box).toContainText("definitely not it");
    await expect(box).toContainText("Jo bet SOLVE");
    await expect(box).toContainText("Priya no bet, so FAIL");
    await expect(box.locator(".sd-banner")).toContainText("Sam: take a drink (wrong guess)");
    await expect(box.locator(".sd-banner")).toContainText("Jo: take a drink (bet SOLVE)");
    await expect(box.locator(".sd-banner")).toContainText("Or skip the drink and ");
    await expect(box.locator(".sd-banner")).toContainText("Passing is always fine.");
    await expect(box).toContainText("Safe: Priya.");
    await expect(box).not.toContainText(phrase);
  }
  // 6. penalty box: the drip resumes and Sam cannot buzz
  await expect.poll(() => phase(jo), { timeout: 10000 }).toBe("drip");
  await expect(sam.page.locator("#solve")).toBeDisabled();
  await expect(sam.page.locator("#solvenote")).toContainText("Penalty box");
  await expect(priya.page.locator("#solve")).toBeEnabled();

  // second attempt: Priya buzzes, both others bet, and she gets it right
  await priya.page.locator("#solve").click();
  await expect.poll(() => phase(jo)).toBe("bet");
  await jo.page.locator("#betfail").click();
  await sam.page.locator("#betsolve").click();
  await expect.poll(() => phase(jo), { timeout: 10000 }).toBe("seat"); // closes early once every bet is in
  await priya.page.locator("#guess").fill("  " + phrase.toUpperCase() + "!! ");
  await priya.page.locator("#guess").press("Enter");
  // 7. round end: phrase, solver, payout and the scoreboard
  for (const p of P) {
    const box = p.page.locator("#endbox");
    await expect(box).toBeVisible();
    await expect(box.locator(".sd-phrase")).toHaveText(phrase);
    await expect(box).toContainText("Solved by Priya.");
    await expect(box).toContainText("Correct!");
    await expect(box).toContainText("Sam bet SOLVE");
    // Jo lost twice this round: the second penalty is the alternative, not a second drink
    await expect(box.locator(".sd-banner")).toContainText("Jo: already had a drink this round, so do the alternative (bet FAIL)");
    await expect(box).toContainText("Safe: Priya and Sam.");
    await expect(box.locator(".sd-rank li").first()).toContainText("Priya");
    await expect(box.locator(".sd-rank li").first()).toContainText("1 solved");
  }
  await expect(sam.page.locator("#nextround")).toBeHidden();
  await expect(jo.page.locator("#nextround")).toBeVisible();
  await expect(jo.page.locator("#endgame")).toBeVisible();
  // next round: a new phrase, the penalty box is empty again
  await jo.page.locator("#nextround").click();
  for (const p of P) await expect(p.page.locator("#roundline")).toHaveText("Round 2");
  await expect(sam.page.locator("#solve")).toBeEnabled();
  expect(await hook(jo, "phrase")).not.toBe(phrase);
  // let the whole phrase drip out: nobody solved it, nobody drinks; then the host ends the game
  await expect.poll(() => phase(sam), { timeout: 120000 }).toBe("end");
  await expect(sam.page.locator("#endbox")).toContainText("nobody solved it. Nobody drinks.");
  await jo.page.locator("#endgame").click();
  for (const p of P) await expect(p.page.locator("#finalbox")).toContainText("Priya wins");
  await expect(jo.page.locator("#again")).toBeVisible();
  for (const p of P) await p.context.close();
});

test("slow drip: the rules keep the phrase and the bets private, and only one buzz can win", async ({ browser }) => {
  const { P, code } = await room(browser, PAGE); // real timings: 3 seconds to bet
  const [jo, sam, priya] = P;
  await jo.page.locator("#start").click();
  for (const p of P) await expect(p.page.locator("#dripbox")).toBeVisible();
  const url = (path, t) => `http://127.0.0.1:9000/rooms/${code}/${path}.json?ns=${NS}&auth=${encodeURIComponent(t)}`;
  const req = jo.page.request;
  const [joTok, samTok, priyaTok] = [await token(jo), await token(sam), await token(priya)];
  const [joUid, samUid, priyaUid] = [await hook(jo, "uid"), await hook(sam, "uid"), await hook(priya, "uid")];
  const phrase = await hook(jo, "phrase");
  // the phrase: the host can read the secret, a guest cannot; the public state never carries it
  expect((await req.get(url("sd/secret", joTok))).status()).toBe(200);
  expect((await req.get(url("sd/secret", samTok))).status()).toBe(401);
  expect((await req.get(url("sd", samTok))).status()).toBe(401);
  const pub = await (await req.get(url("sd/pub", samTok))).json();
  expect(pub.phase).toBe("drip");
  expect(pub.data).not.toContain(phrase);
  expect(pub.deadline).toBeGreaterThan(Date.now() - 60000);
  // a guest cannot publish, cannot open the secret, cannot take the host role while the host is connected
  expect((await req.put(url("sd/pub", samTok), { data: { phase: "end", seq: 99, deadline: 0, data: "{}" } })).status()).toBe(401);
  expect((await req.put(url("sd/secret", samTok), { data: JSON.stringify("x") })).status()).toBe(401);
  expect((await req.put(url("sd/host", samTok), { data: JSON.stringify(samUid) })).status()).toBe(401);
  expect((await req.put(url("sd/box/" + priyaUid, samTok), { data: "true" })).status()).toBe(401);
  // no betting or guessing while the letters are still dripping
  expect((await req.put(url("sd/bet/" + samUid, samTok), { data: JSON.stringify("s") })).status()).toBe(401);
  expect((await req.put(url("sd/guess/" + samUid, samTok), { data: JSON.stringify(phrase) })).status()).toBe(401);
  // a buzz must be your own
  expect((await req.put(url("sd/buzz", samTok), { data: { u: priyaUid, at: { ".sv": "timestamp" } } })).status()).toBe(401);
  // two buzzes at the same moment: exactly one is accepted, and the other cannot overwrite it
  const buzz = (uid, tok) => req.put(url("sd/buzz", tok), { data: { u: uid, at: { ".sv": "timestamp" } } });
  const both = await Promise.all([buzz(samUid, samTok), buzz(priyaUid, priyaTok)]);
  expect(both.map((r) => r.status()).sort()).toEqual([200, 401]);
  const winner = (await (await req.get(url("sd/buzz", joTok))).json()).u;
  expect([samUid, priyaUid]).toContain(winner);
  const [solver, other] = winner === samUid ? [{ uid: samUid, tok: samTok, p: sam }, { uid: priyaUid, tok: priyaTok, p: priya }] : [{ uid: priyaUid, tok: priyaTok, p: priya }, { uid: samUid, tok: samTok, p: sam }];
  expect((await buzz(other.uid, other.tok)).status()).toBe(401);
  expect((await buzz(solver.uid, solver.tok)).status()).toBe(401);
  await expect.poll(() => phase(jo)).toBe("bet");
  await expect(other.p.page.locator("#bethead")).toHaveText(solver.p.name + " is solving.");
  // bets: your own path only, never the solver, and nobody but you and the host can read yours
  expect((await req.put(url("sd/bet/" + other.uid, other.tok), { data: JSON.stringify("s") })).status()).toBe(200);
  expect((await req.put(url("sd/bet/" + solver.uid, solver.tok), { data: JSON.stringify("s") })).status()).toBe(401);
  expect((await req.put(url("sd/bet/" + joUid, other.tok), { data: JSON.stringify("f") })).status()).toBe(401);
  expect((await req.put(url("sd/bet/" + other.uid, other.tok), { data: JSON.stringify("yes") })).status()).toBe(401);
  expect((await req.get(url("sd/bet/" + other.uid, solver.tok))).status()).toBe(401);
  expect((await req.get(url("sd/bet", solver.tok))).status()).toBe(401);
  expect((await req.get(url("sd/bet/" + other.uid, other.tok))).status()).toBe(200);
  expect((await req.get(url("sd/bet", joTok))).status()).toBe(200);
  expect((await (await req.get(url("sd/pub", solver.tok))).json()).data).not.toMatch(/"bets"/);
  // the guess: only the solver, only in the hot seat
  expect((await req.put(url("sd/guess/" + other.uid, other.tok), { data: JSON.stringify("x") })).status()).toBe(401);
  await expect.poll(() => phase(jo), { timeout: 10000 }).toBe("seat");
  expect((await req.put(url("sd/guess/" + other.uid, other.tok), { data: JSON.stringify("x") })).status()).toBe(401);
  expect((await req.get(url("sd/guess/" + solver.uid, other.tok))).status()).toBe(401);
  expect((await req.put(url("sd/bet/" + other.uid, other.tok), { data: JSON.stringify("f") })).status()).toBe(401); // window closed
  expect((await req.put(url("sd/guess/" + solver.uid, solver.tok), { data: JSON.stringify("wrong answer") })).status()).toBe(200);
  // the payout publishes the bets, still without the phrase
  await expect.poll(() => phase(jo)).toBe("payout");
  const after = await (await req.get(url("sd/pub", other.tok))).json();
  expect(JSON.parse(after.data).payout.bets[other.uid]).toBe("s");
  expect(after.data).not.toContain(phrase);
  for (const p of P) await p.context.close();
});

test("slow drip: when the host's phone goes away, the next player takes over and the round ends cleanly", async ({ browser }) => {
  const { P } = await room(browser);
  const [jo, sam, priya] = P;
  await jo.page.locator("#start").click();
  for (const p of P) await expect(p.page.locator("#dripbox")).toBeVisible();
  const phrase = await hook(jo, "phrase");
  await jo.context.close();
  await expect.poll(() => hook(sam, "host"), { timeout: 20000 }).toBe(true);
  expect(await hook(priya, "host")).toBe(false);
  for (const p of [sam, priya]) {
    await expect(p.page.locator("#endbox")).toContainText("The host changed, so this round was skipped. Nobody drinks.");
    await expect(p.page.locator("#endbox .sd-phrase")).toHaveText(phrase);
  }
  await expect(sam.page.locator("#nextround")).toBeVisible();
  await expect(priya.page.locator("#nextround")).toBeHidden();
  await sam.page.locator("#nextround").click();
  for (const p of [sam, priya]) {
    await expect(p.page.locator("#roundline")).toHaveText("Round 2");
    await expect(p.page.locator("#dripbox")).toBeVisible();
  }
  // the new host runs the round: a buzz from Priya is picked up
  await priya.page.locator("#solve").click();
  await expect(sam.page.locator("#bethead")).toHaveText("Priya is solving.");
  for (const p of [sam, priya]) await p.context.close();
});

test("slow drip: practice with 3 bots runs on one phone with no Firebase", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/googletagmanager|google-analytics|gstatic|googleapis|firebaseio|127\.0\.0\.1:(9000|9099)/, (r) => r.abort());
  const page = await context.newPage();
  page.on("pageerror", (e) => { throw e; });
  await page.addInitScript(() => { localStorage.setItem("tp_age_ok", "yes"); localStorage.setItem("tp_sound", "off"); });
  await page.goto(BASE + "/play/slow-drip.html?practice=1&emulator=1&fast=1");
  const hk = (fn) => page.evaluate((f) => window.__tpDrip[f](), fn);
  await expect(page.locator("#table")).toBeVisible();
  await expect(page.locator("#scores li")).toHaveCount(4);
  await expect(page.locator("#scores")).toContainText("(bot)");
  await expect(page.locator("#exitpractice")).toBeVisible();
  expect(await hk("mode")).toBe("practice");
  // buzz until it is our attempt (a bot can get there first), then answer correctly
  for (let i = 0; i < 6; i++) {
    await expect.poll(() => hk("phase"), { timeout: 60000 }).toMatch(/drip|end/);
    if ((await hk("phase")) === "end") { await page.locator("#nextround").click(); continue; }
    await page.locator("#solve").click({ timeout: 3000 }).catch(() => {});
    await expect.poll(() => hk("phase")).not.toBe("drip");
    if ((await hk("data")).solver === "you") break;
  }
  expect((await hk("data")).solver).toBe("you");
  await expect(page.locator("#bethead")).toHaveText("Waiting for bets…");
  await expect.poll(() => hk("phase"), { timeout: 10000 }).toBe("seat");
  await page.locator("#guess").fill(await hk("phrase"));
  await page.locator("#sendguess").click();
  await expect(page.locator("#endbox")).toContainText("Correct!");
  await expect(page.locator("#endbox")).toContainText(/bet (SOLVE|FAIL)|no bet, so FAIL/);
  await expect(page.locator("#nextround")).toBeVisible();
  await page.locator("#nextround").click();
  await expect(page.locator("#roundline")).toHaveText(/Round \d+/);
  await expect(page.locator("#dripbox")).toBeVisible();
  await page.locator("#exitpractice").click();
  await expect(page.locator("#home")).toBeVisible();
  await context.close();
});

test("slow drip: timers show a number and move from yellow to pink; reduced motion is respected", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await context.route(/googletagmanager|google-analytics|gstatic/, (r) => r.abort());
  const page = await context.newPage();
  await page.addInitScript(() => { localStorage.setItem("tp_age_ok", "yes"); localStorage.setItem("tp_sound", "off"); });
  await page.goto(BASE + "/play/slow-drip.html?practice=1&emulator=1&fast=1");
  await expect(page.locator("#dripbox")).toBeVisible();
  const read = () => page.evaluate(() => {
    const t = document.getElementById("driptimer"), f = t.querySelector(".fill");
    return { p: +t.style.getPropertyValue("--p"), hot: t.classList.contains("hot"), num: document.getElementById("dripnum").textContent, bg: getComputedStyle(f).backgroundColor, transition: getComputedStyle(f).transitionDuration, anim: getComputedStyle(t.querySelector(".num")).animationName };
  });
  /* color-mix() computes to "color(srgb r g b)" with 0 to 1 channels; plain colours compute to "rgb(r, g, b)" */
  const rgb = (s) => { const n = s.match(/[\d.]+/g).slice(0, 3).map(Number); return /^color\(/.test(s) ? n.map((v) => v * 255) : n; };
  const start = await read();
  await expect.poll(async () => (await read()).p, { timeout: 15000 }).toBeGreaterThan(0.7);
  const late = await read();
  expect(late.num).toMatch(/^[0-9]+$/);            // the number is always there
  expect(late.hot).toBe(true);                     // and so is a class, for browsers without color-mix
  expect(late.transition).toBe("0s");              // reduced motion: no sliding bar
  expect(late.anim).toBe("none");                  // and no pulsing number
  // the fill has moved away from yellow (255, 214, 10) toward pink (255, 61, 127): less green, more blue
  if (start.p < 0.4) { expect(rgb(late.bg)[1]).toBeLessThan(rgb(start.bg)[1]); expect(rgb(late.bg)[2]).toBeGreaterThan(rgb(start.bg)[2]); }
  await context.close();
});
