/* Split Decision Phase 1 on six phones, against the Firebase emulator and the real rules.
   Simultaneous answers, one player refreshing mid-round, one player who never answers.
   The reveal on every phone must match PosterLogic.scoreRound. */
const { test, expect } = require("@playwright/test");
const L = require("../play/poster-logic.js");

const BASE = process.env.TIPSY_BASE || "http://127.0.0.1:8765";
const GAME = "/games/split-decision.html";

async function boot(browser, name, opts){
  const context = await browser.newContext(Object.assign({
    serviceWorkers: "block",
    viewport: { width: 360, height: 780 },
    hasTouch: true
  }, opts || {}));
  await context.route(/googletagmanager|google-analytics|analytics\.google/, (route) => route.abort());
  const prod = [];
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("request", (req) => { if (/firebaseio\.com|firebaseapp\.com/.test(req.url())) prod.push(req.url()); });
  await page.addInitScript((player) => {
    localStorage.setItem("tp_age_ok", "yes");
    localStorage.setItem("tp_sound", "off");
    localStorage.setItem("tp_name", player);
  }, name);
  await page.goto(BASE + GAME + "?emulator=1", { waitUntil: "domcontentloaded" });
  await page.locator("#hostbtn").waitFor({ state: "visible" });
  return { name, context, page, prod, errors };
}
async function hostRoom(p){
  await p.page.locator("#pname").fill(p.name);
  await p.page.locator("#hostbtn").click();
  await expect(p.page.locator("#lobby")).toBeVisible();
  return (await p.page.locator("#codebig").innerText()).trim();
}
async function joinRoom(p, code){
  await p.page.locator("#pname").fill(p.name);
  await p.page.locator("#roomcode").fill(code);
  await p.page.locator("#joinbtn").click();
  await expect(p.page.locator("#lobby")).toBeVisible();
}
const pick = (p, letter) => p.page.locator(".poster-choice", { hasText: new RegExp("^" + letter + " ·") }).click();
async function guess(p, n){
  await expect(p.page.locator("#statusline")).toContainText("How many");
  await p.page.locator(".poster-choice", { hasText: new RegExp("^" + n + "$") }).click();
  // The last guess can end the round at once, so the reveal may already have replaced "Locked".
  await expect(p.page.locator("#statusline").filter({ hasText: "Locked" }).or(p.page.locator(".sd-me"))).toBeVisible();
}
const read = (p, path) => p.page.evaluate((x) => window.__tpTest.readPath("rooms/" + window.__tpTest.code() + "/" + x), path);

test("six phones: simultaneous answers, a refresh mid-round, a no-show, and a reveal that matches scoreRound", async ({ browser }) => {
  test.setTimeout(240000);
  const names = ["Ada", "Bea", "Cal", "Dev", "Eli", "Fay"];
  const ps = [];
  for (const n of names) ps.push(await boot(browser, n));
  const [ada, bea, cal, dev, eli, fay] = ps;
  const code = await hostRoom(ada);
  for (const p of ps.slice(1)) await joinRoom(p, code);
  await expect(ada.page.locator("#plist .nh-person")).toHaveCount(6);
  await ada.page.locator("#optin").check();
  await ada.page.locator("#start").click();
  for (const p of ps) await expect(p.page.locator("#table")).toBeVisible();

  // Question screen: timer, two big A/B buttons, names-only list.
  await expect(ada.page.locator("#sdtimer")).toBeVisible();
  const startSecs = +(await ada.page.locator("#sdtimern").innerText());
  expect(startSecs).toBeGreaterThan(14);
  expect(startSecs).toBeLessThanOrEqual(20);
  const ab = ada.page.locator(".poster-choice");
  await expect(ab).toHaveCount(2);
  for (const box of [await ab.nth(0).boundingBox(), await ab.nth(1).boundingBox()]) {
    expect(box.height).toBeGreaterThanOrEqual(64);
    expect(box.width).toBeGreaterThan(280);
  }
  await expect(ada.page.locator("#sdwho li")).toHaveCount(6);
  const t0 = Date.now();

  // Five phones answer at the same moment. Fay never answers.
  await Promise.all([pick(ada, "A"), pick(bea, "A"), pick(cal, "A"), pick(dev, "B"), pick(eli, "B")]);

  // Nothing leaks before the reveal: no other phone can read a pick, and the list shows names only.
  const adaUid = await ada.page.evaluate(() => window.__tpTest.uid());
  const leak = await cal.page.evaluate((u) => window.__tpTest.readPath("rooms/" + window.__tpTest.code() + "/sealed/1/0/" + u), adaUid);
  expect(leak.ok).toBe(false);
  const whoText = await fay.page.locator("#sdwho").innerText();
  expect(whoText).not.toMatch(/\bA\b|\bB\b|picked|guessed/i);
  expect(whoText).toContain("Ada");
  const castBefore = await read(cal, "nhie/cast");
  expect(castBefore.val).toBeNull();

  // Bea refreshes after picking A and before guessing. Her pick survives; she still guesses.
  await bea.page.reload({ waitUntil: "domcontentloaded" });
  await expect(bea.page.locator("#table")).toBeVisible({ timeout: 20000 });
  await expect(bea.page.locator("#statusline")).toContainText("How many of the other 5");
  await expect(bea.page.locator(".poster-choice")).toHaveCount(6);

  // Guesses: Ada (A) says 2 = exact, Bea (A) says 3 = one away, Cal (A) says 0 = miss,
  // Dev (B) says 3 = exact, Eli (B) says 1 = miss. Fay is missed.
  await Promise.all([guess(ada, 2), guess(bea, 3), guess(cal, 0), guess(dev, 3), guess(eli, 1)]);

  // The clock runs out for Fay; the host's phone reveals without a tap.
  await expect(ada.page.locator(".sd-me")).toBeVisible({ timeout: 30000 });
  // The next round would start on its own; the host pauses so the checks below can take their time.
  await expect(ada.page.locator("#pausebtn")).toBeVisible();
  await ada.page.locator("#pausebtn").click();
  for (const p of ps) await expect(p.page.locator(".sd-me")).toBeVisible({ timeout: 30000 });
  await expect(cal.page.locator("#sdnext")).toHaveText("Paused by the host.");
  await expect(cal.page.locator("#pausebtn")).toBeHidden();
  const roundMs = Date.now() - t0;
  expect(roundMs).toBeLessThan(60000);

  // Rebuild the expected result from the now-revealed seals and the frozen roster.
  const play = (await read(ada, "nhie/play")).val;
  const sealed = (await read(cal, "sealed/1/0")).val;
  const players = (await read(ada, "players")).val;
  const roster = play.order.split(",");
  expect(roster.length).toBe(6);
  const expected = L.scoreRound(roster.map((id) => {
    const s = L.parseSplitSeal(sealed[id]);
    return { id, answer: s.pref, prediction: s.pred };
  }));
  const byName = {};
  expected.rows.forEach((r) => { byName[players[r.id].name] = r; });
  expect(byName.Ada.result).toBe("exact");
  expect(byName.Bea.result).toBe("one-away");
  expect(byName.Cal.result).toBe("miss");
  expect(byName.Dev.result).toBe("exact");
  expect(byName.Eli.result).toBe("miss");
  expect(byName.Fay.result).toBe("missed");

  // The stored rows are exactly the scoreRound output, written once.
  const cast = (await read(dev, "nhie/cast")).val;
  expected.rows.forEach((r) => {
    const d = L.decodeResult(cast[r.id]);
    expect(d.round).toBe(0);
    expect([d.result, d.points, d.answer, d.prediction]).toEqual([r.result, r.points, r.answer, r.prediction]);
  });

  const label = { "exact": "EXACT", "one-away": "ONE AWAY", "miss": "MISS", "missed": "MISSED" };
  const board = [];
  for (const p of ps) {
    const mine = byName[p.name];
    await expect(p.page.locator(".sd-me .sd-badge")).toHaveText(label[mine.result]);
    await expect(p.page.locator(".sd-me-num")).toHaveText((mine.points > 0 ? "+" : "") + mine.points);
    await expect(p.page.locator(".sd-split-count")).toHaveText("A " + expected.aCount + " · B " + expected.bCount);
    await expect(p.page.locator(".sd-pcard")).toHaveCount(6);
    for (const n of names) {
      const card = p.page.locator(".sd-pcard", { has: p.page.locator(".sd-pname", { hasText: new RegExp("^" + n + "$") }) });
      const r = byName[n];
      await expect(card.locator(".sd-badge")).toHaveText(label[r.result]);
      await expect(card.locator(".sd-ppts")).toHaveText((r.points > 0 ? "+" : "") + r.points);
      await expect(card.locator(".sd-pline")).toHaveText(r.answer ? "Picked " + r.answer + " · guessed " + r.prediction : "No answer");
    }
    await expect(p.page.locator(".sd-quip")).toBeVisible();
    expect(L.QUIPS[mine.result]).toContain(await p.page.locator(".sd-quip").innerText());
    await expect(p.page.locator(".sd-row")).toHaveCount(6);
    await expect(p.page.locator(".sd-row").first().locator(".sd-total")).toHaveText("2");
    board.push(await p.page.locator(".sd-rows").evaluate((ol) => Array.from(ol.children).map((li) =>
      li.querySelector(".sd-rank").textContent + " " + li.querySelector(".sd-rname > span").textContent + " " + li.querySelector(".sd-total").textContent)));
  }
  // Every phone shows the same leaderboard.
  board.forEach((b) => expect(b).toEqual(board[0]));
  expect(board[0].slice(0, 2).sort()).toEqual(["1 Ada 2", "1 Dev 2"]);
  expect(board[0][2]).toBe("3 Bea 1");
  await expect(ada.page.locator(".sd-row.leader")).toHaveCount(2);

  // No horizontal scroll at 360px on the reveal.
  for (const p of ps) {
    const over = await p.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(over).toBe(false);
  }

  // A second write attempt from the host for the same round is skipped by the round guard.
  const castAgain = (await read(eli, "nhie/cast")).val;
  expect(castAgain).toEqual(cast);

  // Host taps Continue; round 2 starts on every phone with the scores carried.
  await expect(ada.page.locator("#nextround")).toHaveText("Continue");
  await expect(bea.page.locator("#nextround")).toBeHidden();
  await ada.page.locator("#nextround").click();
  for (const p of ps) await expect(p.page.locator("#roundlabel")).toHaveText("Round 2 of 8");
  // Round 2: Fay uses Pass (the visible opt-out); the other five pick B and guess 0. The round does not wait for Fay.
  const others = ps.slice(0, 5);
  await expect(fay.page.locator("#passbtn")).toBeVisible();
  expect((await fay.page.locator("#passbtn").boundingBox()).height).toBeGreaterThanOrEqual(44);
  await fay.page.locator("#passbtn").click();
  await expect(fay.page.locator("#statusline")).toContainText("You passed");
  await expect(fay.page.locator("#passbtn")).toBeHidden();
  await Promise.all(others.map((p) => pick(p, "B")));
  await expect(ada.page.locator("#passbtn")).toBeHidden();
  await Promise.all(others.map((p) => guess(p, 0))); // all B: nobody else picked A
  for (const p of others) await expect(p.page.locator(".sd-me .sd-badge")).toHaveText("EXACT", { timeout: 15000 });
  await expect(fay.page.locator(".sd-me .sd-badge")).toHaveText("MISSED");
  await expect(ada.page.locator(".sd-row").first().locator(".sd-total")).toHaveText("4");
  // Nobody climbed a place this round, so there is no biggest mover.
  await expect(fay.page.locator(".sd-row.mover")).toHaveCount(0);
  await expect(fay.page.locator(".sd-row").nth(2).locator(".sd-delta")).toHaveText("+2 this round");

  for (const p of ps) {
    expect(p.errors, p.name + " page errors").toEqual([]);
    expect(p.prod, "production Firebase was contacted").toEqual([]);
    await p.context.close();
  }
});
