/* Five Letter Frenzy on the Firebase emulators. Nothing talks to production.
   Three phones play a round, then the rules are checked, including host takeover. */
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const BASE = process.env.TIPSY_BASE || "http://127.0.0.1:8765";
const PAGE = "/games/five-letter-frenzy.html?emulator=1&fast=1&word=crane";
const NS = "tipsyplay-f3c95-default-rtdb";
const ART = "/opt/cursor/artifacts";
const PROMPT = "One small drink or a 5-second pose — or Pass.";
fs.mkdirSync(ART, { recursive: true });

async function phone(browser, name, viewport) {
  const context = await browser.newContext({
    viewport: viewport || { width: 390, height: 844 },
    hasTouch: true,
    serviceWorkers: "block"
  });
  await context.route(/googletagmanager|google-analytics/, (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
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
const phase = (p) => hook(p, "phase");
const token = (p) => p.page.evaluate(async () => {
  const m = await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js");
  return m.getAuth().currentUser.getIdToken();
});
async function room(browser, viewport) {
  const P = [
    await phone(browser, "Jo", viewport),
    await phone(browser, "Sam", viewport),
    await phone(browser, "Priya", viewport)
  ];
  await P[2].page.locator("#dryme").check();
  await P[0].page.locator("#hostbtn").click();
  await expect(P[0].page.locator("#lobby")).toBeVisible();
  const code = (await P[0].page.locator("#codebig").innerText()).trim();
  expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
  for (const p of P.slice(1)) {
    await p.page.locator("#roomcode").fill(code);
    await p.page.locator("#joinbtn").click();
    await expect(p.page.locator("#lobby")).toBeVisible();
  }
  await expect(P[0].page.locator("#start")).toBeEnabled();
  return { P, code };
}
async function guess(p, word) {
  await p.page.locator("#guess").fill(word);
  await p.page.locator("#sendguess").click();
}
async function overflow(page) {
  return page.evaluate(() => ({
    over: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth
  }));
}

test("three phones play a round: guesses, Pass, a dry player, a solve, Play again, points only, late join", async ({ browser }) => {
  const { P, code } = await room(browser);
  const [jo, sam, priya] = P;
  await expect(jo.page.locator("body")).toContainText("You must be of legal drinking age in your location.");
  expect(await jo.page.content()).toContain("G-BHY4BXF3V3");
  expect(await jo.page.content()).toContain("You must be of legal drinking age in your location.");
  await jo.page.screenshot({ path: path.join(ART, "frenzy-lobby-390.png") });

  await jo.page.locator("#start").click();
  await expect.poll(() => phase(jo)).toBe("guess");
  await expect(jo.page.locator("#turnlabel")).toHaveText("Your turn");
  await expect(sam.page.locator("#turnlabel")).toHaveText("Waiting for Jo");
  expect(await hook(jo, "secret")).toBeNull();
  expect(await hook(sam, "secret")).toBeNull();
  expect(await hook(jo, "token")).toMatch(/^[a-f0-9]{32}$/);
  expect(JSON.stringify(await hook(sam, "data"))).not.toContain("crane");
  expect(JSON.stringify(await hook(jo, "data"))).not.toContain("crane");

  await guess(jo, "house");
  await expect.poll(() => phase(jo)).toBe("prompt");
  await expect(jo.page.locator("#prompttext")).toHaveText(PROMPT);
  for (const id of ["#drinkbtn", "#posebtn", "#passbtn"]) {
    expect((await jo.page.locator(id).boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await jo.page.screenshot({ path: path.join(ART, "frenzy-prompt-390.png") });
  await jo.page.locator("#passbtn").click();

  await expect.poll(() => phase(sam)).toBe("guess");
  await expect(sam.page.locator("#turnlabel")).toHaveText("Your turn");
  await expect(jo.page.locator("#grid .fl-tile.lock").first()).toBeVisible();
  await sam.page.screenshot({ path: path.join(ART, "frenzy-grid-390.png") });
  await guess(sam, "stone");
  await expect.poll(() => phase(sam)).toBe("prompt");
  await sam.page.locator("#passbtn").click();

  await expect.poll(() => hook(priya, "turn")).toBe(await hook(priya, "uid"));
  const joUid = await hook(jo, "uid");
  await guess(priya, "music");
  // Priya opted into points only for herself, so the drink prompt never opens.
  // The word keeper answers over the network, so wait for her pass to land.
  await expect(jo.page.locator("#actline")).toContainText("Priya passed");
  await expect.poll(() => phase(jo)).toBe("guess");
  await expect(priya.page.locator("#promptbox")).toBeHidden();
  await expect.poll(() => hook(jo, "turn")).toBe(joUid);

  await guess(jo, "crane");
  await expect.poll(() => phase(jo)).toBe("handoff");
  await expect(jo.page.locator("#handbox")).toContainText("You skip this one.");
  await expect(jo.page.locator("#handbox")).toContainText("They can still Pass.");
  await jo.page.locator("#handlist button", { hasText: "Sam" }).click();
  await expect.poll(() => hook(sam, "turn")).toBe(await hook(sam, "uid"));
  await expect(sam.page.locator("#prompttext")).toHaveText(PROMPT);
  await sam.page.locator("#passbtn").click();

  await expect.poll(() => phase(priya)).toBe("end");
  await expect(jo.page.locator("#awards")).toContainText("CRANE");
  await expect(jo.page.locator("#awards")).toContainText("Solved it");
  await expect(jo.page.locator("#again")).toBeVisible();
  await expect(sam.page.locator("#again")).toBeHidden();
  await jo.page.screenshot({ path: path.join(ART, "frenzy-recap-390.png") });
  for (const p of P) expect(p.errors).toEqual([]);

  await jo.page.locator("#again").click();
  await expect(jo.page.locator("#lobby")).toBeVisible();
  await expect(sam.page.locator("#lobby")).toBeVisible();
  await jo.page.locator("#pointsonly").click();
  await expect(jo.page.locator("#pointsonly")).toHaveAttribute("aria-pressed", "true");
  await expect(priya.page.locator("#pointsnote")).toContainText("Points only");
  await jo.page.locator("#start").click();
  await expect.poll(() => phase(jo)).toBe("guess");
  expect((await hook(jo, "data")).pointsOnly).toBe(true);
  // The seat that starts moved on, so the guess comes from whoever the table is waiting on.
  let seat = jo;
  for (const p of P) if ((await hook(p, "turn")) === (await hook(p, "uid"))) seat = p;
  await expect(seat.page.locator("#turnlabel")).toHaveText("Your turn");
  const seatUid = await hook(seat, "uid");
  await guess(seat, "house");
  await expect.poll(() => phase(jo)).toBe("guess");
  await expect(seat.page.locator("#promptbox")).toBeHidden();
  await expect.poll(() => hook(jo, "turn")).not.toBe(seatUid);

  const late = await phone(browser, "Dee");
  await late.page.locator("#roomcode").fill(code);
  await late.page.locator("#joinbtn").click();
  await expect(late.page.locator("#perr")).toContainText("This round has already started");
  await expect(late.page.locator("#lobby")).toBeHidden();

  for (const p of P.concat(late)) await p.context.close();
});

test("rules hide the secret, guests cannot write host state, and a long-idle host can be taken over", async ({ browser }) => {
  const { P, code } = await room(browser);
  const [jo, sam, priya] = P;
  await jo.page.locator("#start").click();
  await expect.poll(() => phase(jo)).toBe("guess");
  const url = (p, t) => `http://127.0.0.1:9000/rooms/${code}/${p}.json?ns=${NS}&auth=${encodeURIComponent(t)}`;
  const req = jo.page.request;
  const [joTok, samTok, priyaTok] = [await token(jo), await token(sam), await token(priya)];
  const [joUid, samUid] = [await hook(jo, "uid"), await hook(sam, "uid")];

  expect((await req.get(url("fl/secret", joTok))).status()).toBe(401);
  expect((await req.get(url("fl/secret", samTok))).status()).toBe(401);
  expect((await req.get(url("fl/secret", priyaTok))).status()).toBe(401);
  expect((await req.get(url("ql/secret", joTok))).status()).toBe(200);
  expect((await req.get(url("ql/secret", samTok))).status()).toBe(401);
  const pub = await (await req.get(url("fl/pub", samTok))).json();
  expect(pub.phase).toBe("guess");
  expect(pub.data).not.toContain("crane");
  expect((await req.put(url("fl/pub", samTok), { data: { phase: "end", seq: 9, opened: 1, data: "{}" } })).status()).toBe(401);
  expect((await req.put(url("fl/secret", samTok), { data: JSON.stringify({ G: { word: "nope" } }) })).status()).toBe(401);
  expect((await req.put(url("fl/guess/" + samUid, samTok), { data: JSON.stringify("house:1") })).status()).toBe(401);

  const meta = await (await req.get(url("meta", samTok))).json();
  meta.hostUid = samUid;
  expect((await req.put(url("meta", samTok), { data: meta })).status()).toBe(401);
  // A combined claim that also moves the secret is refused: secret still sees the old host.
  const both = await req.patch(`http://127.0.0.1:9000/.json?ns=${NS}&auth=${encodeURIComponent(samTok)}`, {
    data: {
      ["rooms/" + code + "/meta/hostUid"]: samUid,
      ["rooms/" + code + "/fl/secret"]: JSON.stringify({ G: { word: "leaked" } })
    }
  });
  expect(both.status()).toBe(401);
  expect((await (await req.get(url("meta", joTok))).json()).hostUid).toBe(joUid);

  await jo.page.evaluate(() => { window.__tpFrenzyHoldBeat = true; });
  const oldBeat = Date.now() - 130000;
  expect((await req.put(url("fl/beat", joTok), { data: String(oldBeat) })).status()).toBe(200);
  await jo.page.waitForTimeout(2500);
  expect(await hook(sam, "host")).toBe(false);

  await jo.context.close();
  await expect.poll(() => hook(sam, "host"), { timeout: 20000 }).toBe(true);
  expect(await hook(priya, "host")).toBe(false);
  const log = await hook(sam, "claimLog");
  expect(log).toEqual(["meta"]);
  expect(await hook(sam, "secret")).toBeNull();
  expect(await hook(priya, "secret")).toBeNull();
  const samTok2 = await token(sam);
  const samReq = sam.page.request;
  expect((await samReq.get(url("fl/secret", samTok2))).status()).toBe(401);
  expect((await samReq.get(url("fl/secret", await token(priya)))).status()).toBe(401);
  expect((await (await samReq.get(url("meta", samTok2))).json()).hostUid).toBe(samUid);
  await expect(sam.page.locator("#lobby")).toBeVisible();
  await expect(sam.page.locator("body")).toContainText("The word was not shown");
  await expect(priya.page.locator("#lobby")).toBeVisible();
  await expect(priya.page.locator("body")).toContainText("The word was not shown");

  await sam.context.close();
  await priya.context.close();
});

test("the host can pause, skip, and remove, and a disconnected turn is skipped", async ({ browser }) => {
  const { P } = await room(browser);
  const [jo, sam, priya] = P;
  await jo.page.locator("#start").click();
  await expect.poll(() => phase(jo)).toBe("guess");
  await jo.page.locator("#pausebtn").click();
  await expect(jo.page.locator("#turnlabel")).toHaveText("Paused");
  await expect(jo.page.locator("#guessform")).toBeHidden();
  await jo.page.locator("#pausebtn").click();
  await expect(jo.page.locator("#turnlabel")).toHaveText("Your turn");

  await jo.page.locator("#skipbtn").click();
  await expect.poll(() => hook(sam, "turn")).toBe(await hook(sam, "uid"));
  await expect(sam.page.locator("#turnlabel")).toHaveText("Your turn");
  await expect(jo.page.locator("#actline")).toContainText("passed");

  await jo.page.locator("#rmmenubtn").click();
  await jo.page.locator("#rmsheet button", { hasText: "Remove Priya" }).click();
  await expect.poll(() => jo.page.evaluate(() => Object.values((window.__tpFrenzy.data() || {}).names || {}).join(","))).not.toContain("Priya");
  await expect(sam.page.locator("#turnlabel")).toHaveText("Your turn");

  const samUid = await hook(sam, "uid");
  await sam.context.close();
  await expect.poll(() => hook(jo, "turn"), { timeout: 15000 }).not.toBe(samUid);
  await expect(jo.page.locator("#turnlabel")).toHaveText("Your turn");
  await jo.context.close();
  await priya.context.close();
});

test("the lobby and the prompt do not overflow at 320, 375, or 390", async ({ browser }) => {
  const { P } = await room(browser, { width: 390, height: 844 });
  const jo = P[0];
  for (const width of [320, 375, 390]) {
    await jo.page.setViewportSize({ width, height: 800 });
    const box = await overflow(jo.page);
    expect(box.over, "lobby " + width + " " + box.sw + ">" + box.cw).toBe(false);
  }
  await jo.page.setViewportSize({ width: 390, height: 844 });
  await jo.page.locator("#start").click();
  await expect.poll(() => phase(jo)).toBe("guess");
  await guess(jo, "house");
  await expect.poll(() => phase(jo)).toBe("prompt");
  for (const width of [320, 375, 390]) {
    await jo.page.setViewportSize({ width, height: 800 });
    const box = await overflow(jo.page);
    expect(box.over, "prompt " + width).toBe(false);
  }
  for (const p of P) await p.context.close();
});

test("the word keeper refuses direct abuse", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const post = (body) => page.request.post(BASE + "/api/frenzy-word.php", { data: body });
  const room = "WXYZ";
  const started = await (await post({ op: "start", room: room, testWord: "crane" })).json();
  expect(started.ok).toBe(true);
  expect(started.token).toMatch(/^[a-f0-9]{32}$/);
  expect(started.word).toBeUndefined();
  const token = started.token;
  // A stranger who knows the room code cannot replace a round that has not been guessed yet.
  expect((await post({ op: "start", room: room })).status()).toBe(409);
  expect((await post({ op: "start", room: room, token: "not-the-token" })).status()).toBe(409);
  const restarted = await (await post({ op: "start", room: room, token: token, testWord: "crane" })).json();
  expect(restarted.ok).toBe(true);
  expect(restarted.token).toMatch(/^[a-f0-9]{32}$/);
  expect(restarted.token).not.toBe(token);
  expect(restarted.word).toBeUndefined();
  const live = restarted.token;
  expect((await post({ op: "guess", room: room, token: token, guess: "house", n: 0 })).status()).toBe(403);
  expect((await post({ op: "reveal", room: room, token: live })).status()).toBe(403);
  expect((await post({ op: "guess", room: room, token: "nope", guess: "house", n: 0 })).status()).toBe(403);
  expect((await post({ op: "guess", room: room, token: live, guess: "zzzzz", n: 0 })).status()).toBe(400);
  expect((await post({ op: "guess", room: room, token: live, guess: "house", n: 2 })).status()).toBe(409);
  const first = await (await post({ op: "guess", room: room, token: live, guess: "house", n: 0 })).json();
  expect(first.ok).toBe(true);
  expect(first.marks).toEqual(["absent", "absent", "absent", "absent", "locked"]);
  expect(first.word).toBeUndefined();
  const words = ["stone", "music", "crate", "trace", "books"];
  for (let i = 0; i < words.length; i++) {
    const res = await (await post({ op: "guess", room: room, token: live, guess: words[i], n: i + 1 })).json();
    expect(res.ok, words[i]).toBe(true);
  }
  expect((await post({ op: "guess", room: room, token: live, guess: "party", n: 6 })).status()).toBe(409);
  const revealed = await (await post({ op: "reveal", room: room, token: live })).json();
  expect(revealed.word).toBe("crane");
  let limited = 0;
  for (let i = 0; i < 80 && !limited; i++) {
    const res = await post({ op: "beat", room: "ABCD", token: "00" });
    if (res.status() === 429) limited = 1;
  }
  expect(limited).toBe(1);
  await ctx.close();
});
