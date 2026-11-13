/* Vault Traitor in real browsers against the Firebase emulators: a full three-phone game,
   and the database rules that keep the code, roles, lies and ballots private. */
const { test, expect } = require("@playwright/test");
const BASE = process.env.TIPSY_BASE || "http://127.0.0.1:8765";
const PAGE = "/games/vault-traitor.html?emulator=1&fast=1";
const NS = "tipsyplay-f3c95-default-rtdb";

async function phone(browser, name) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/googletagmanager|google-analytics/, (r) => r.abort());
  const page = await context.newPage();
  await page.addInitScript((n) => { localStorage.setItem("tp_age_ok", "yes"); localStorage.setItem("tp_name", n); }, name);
  await page.goto(BASE + PAGE);
  await page.locator("#hostbtn").waitFor({ state: "visible" });
  return { context, page, name };
}
const phase = (p) => p.page.evaluate(() => window.__tpVault && window.__tpVault.phase());
const role = (p) => p.page.evaluate(() => window.__tpVault && window.__tpVault.role());
const token = (p) => p.page.evaluate(async () => {
  const m = await import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js");
  return m.getAuth().currentUser.getIdToken();
});
async function room(browser) {
  const P = [await phone(browser, "Jo"), await phone(browser, "Sam"), await phone(browser, "Priya")];
  await P[0].page.locator("#hostbtn").click();
  await expect(P[0].page.locator("#lobby")).toBeVisible();
  const code = (await P[0].page.locator("#codebig").innerText()).trim();
  for (const p of P.slice(1)) {
    await p.page.locator("#roomcode").fill(code);
    await p.page.locator("#joinbtn").click();
    await expect(p.page.locator("#lobby")).toBeVisible();
  }
  return { P, code };
}

test("vault traitor: a full game on three phones, with one Traitor caught by a secret vote", async ({ browser }) => {
  const host = await phone(browser, "Jo");
  await host.page.locator("#hostbtn").click();
  await expect(host.page.locator("#lobby")).toBeVisible();
  const code = (await host.page.locator("#codebig").innerText()).trim();
  // a name already in the room is refused, ignoring case
  const twin = await phone(browser, "jo");
  await twin.page.locator("#roomcode").fill(code);
  await twin.page.locator("#joinbtn").click();
  await expect(twin.page.locator("#perr")).toHaveText("Someone already has that name. Try another.");
  await twin.context.close();
  const P = [host, await phone(browser, "Sam"), await phone(browser, "Priya")];
  for (const p of P.slice(1)) {
    await p.page.locator("#roomcode").fill(code);
    await p.page.locator("#joinbtn").click();
    await expect(p.page.locator("#lobby")).toBeVisible();
  }
  await expect(host.page.locator("#start")).toBeEnabled();
  await expect(host.page.locator("#drinknote")).toContainText("Drinks");
  await expect(host.page.locator(".na")).toContainText("pace yourself");
  await host.page.locator("#start").click();
  // each phone sees only its own role; exactly one Traitor among three
  for (const p of P) await expect(p.page.locator("#rolebox")).toBeVisible();
  const roles = [];
  for (const p of P) roles.push(await role(p));
  expect(roles.filter((r) => r === "traitor").length).toBe(1);
  for (const p of P) await p.page.locator("#readybtn").click();
  await expect.poll(() => phase(host)).toBe("turn");
  // the keypad shows only on the guesser's phone; submit waits for four digits
  const turnIdx = [];
  for (let i = 0; i < 3; i++) if (await P[i].page.locator("#keypad").isVisible()) turnIdx.push(i);
  expect(turnIdx.length).toBe(1);
  const g = P[turnIdx[0]];
  await expect(g.page.locator("#submitguess")).toBeDisabled();
  for (const d of "123") await g.page.locator(`#keys [data-k="${d}"]`).click();
  await expect(g.page.locator("#submitguess")).toBeDisabled();
  await g.page.keyboard.press("4");
  await expect(g.page.locator("#submitguess")).toBeEnabled();
  for (const k of (await g.page.locator("#keys button").all())) expect((await k.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await g.page.locator("#submitguess").click();
  // sealing: everyone sees the same wait; only the Traitor gets options
  await expect.poll(() => phase(host)).toMatch(/seal|debate|end/);
  // debate: the guess is on every board with text labels, then someone calls a vote
  await expect.poll(() => phase(host), { timeout: 10000 }).toMatch(/debate|end/);
  if (await phase(host) === "end") return; // a lucky first guess cracked it
  for (const p of P) await expect(p.page.locator("#board li").first()).toContainText("1234:");
  await expect(host.page.locator("#board li").first()).toContainText(/exact, \d misplaced/);
  const caller = P[roles.indexOf("codebreaker")];
  await caller.page.locator("#callvote").click();
  await expect.poll(() => phase(host)).toBe("ballot");
  // secret ballots: no self-vote offered; everyone votes for the Traitor
  const traitorName = P[roles.indexOf("traitor")].name;
  for (const p of P) {
    const names = await p.page.locator("#ballotlist button").allInnerTexts();
    expect(names).not.toContain(p.name);
    const pick = p.name === traitorName ? names[0] : traitorName;
    await p.page.locator("#ballotlist button", { hasText: pick }).click();
  }
  await expect.poll(() => phase(host), { timeout: 10000 }).toMatch(/tally|choice|banner|end/);
  await expect(host.page.locator("#tallybox")).toContainText(traitorName + " was a Traitor!");
  // the caught Traitor makes a private choice; the shared banner is pink and lists them
  const traitor = P[roles.indexOf("traitor")];
  await expect(traitor.page.locator("#choicebox")).toBeVisible({ timeout: 10000 });
  await expect(caller.page.locator("#choicebox")).toBeHidden(); // a Codebreaker's phone shows no choice
  await traitor.page.locator("#choicelist button", { hasText: "Drink" }).click();
  await expect(host.page.locator("#banner")).toContainText(traitorName + ": one drink", { timeout: 10000 });
  // round end: code, roles, lies, votes and the summary
  await expect.poll(() => phase(host), { timeout: 15000 }).toBe("end");
  const reveal = host.page.locator("#reveal");
  await expect(reveal).toContainText("Codebreakers win");
  await expect(reveal).toContainText("Every Traitor is out.");
  await expect(reveal.locator(".vt-code")).toHaveText(/^[0-9]{4}$/);
  await expect(reveal).toContainText(traitorName + ": Traitor (caught)");
  await expect(reveal).toContainText("Correct calls");
  // play again keeps the players and deals new roles
  await host.page.locator("#again").click();
  for (const p of P) await expect(p.page.locator("#rolebox")).toBeVisible();
  for (const p of P) await p.context.close();
});

test("vault traitor: the rules keep the code, roles, lies and ballots private", async ({ browser }) => {
  const { P, code } = await room(browser);
  await P[0].page.locator("#start").click();
  for (const p of P) await expect(p.page.locator("#rolebox")).toBeVisible();
  const url = (path, t) => `http://127.0.0.1:9000/rooms/${code}/${path}.json?ns=${NS}&auth=${encodeURIComponent(t)}`;
  const guest = P[1], hostTok = await token(P[0]), guestTok = await token(guest);
  const hostUid = await P[0].page.evaluate(() => window.__tpVault.uid());
  const guestUid = await guest.page.evaluate(() => window.__tpVault.uid());
  const otherUid = await P[2].page.evaluate(() => window.__tpVault.uid());
  // the host can read the secret; a guest cannot read it, nor anyone else's role
  expect((await guest.page.request.get(url("vt/secret", hostTok))).status()).toBe(200);
  expect((await guest.page.request.get(url("vt/secret", guestTok))).status()).toBe(401);
  expect((await guest.page.request.get(url("vt/role/" + otherUid, guestTok))).status()).toBe(401);
  expect((await guest.page.request.get(url("vt/role/" + hostUid, guestTok))).status()).toBe(401);
  expect((await guest.page.request.get(url("vt/role/" + guestUid, guestTok))).status()).toBe(200);
  // the public state never carries the code
  const pub = await (await guest.page.request.get(url("vt/pub", guestTok))).json();
  const secret = JSON.parse(await (await guest.page.request.get(url("vt/secret", hostTok))).json());
  expect(pub.data).not.toContain(secret.G.code);
  expect(pub.data).not.toContain("traitor");
  // nobody can act out of turn, and only a Traitor can file a lie
  for (const p of P) await p.page.locator("#readybtn").click();
  await expect.poll(() => phase(P[0])).toBe("turn");
  const pubNow = await (await guest.page.request.get(url("vt/pub", guestTok))).json();
  const notTurn = [P[0], P[1], P[2]].find((p, i) => [hostUid, guestUid, otherUid][i] !== pubNow.turn);
  const notTurnUid = await notTurn.page.evaluate(() => window.__tpVault.uid());
  const notTurnTok = await token(notTurn);
  const act = await guest.page.request.put(url("vt/act/" + notTurnUid, notTurnTok), { data: JSON.stringify("g:1234:" + pubNow.seq) });
  expect(act.status()).toBe(401);
  const codebreaker = [];
  for (const p of P) if (await role(p) === "codebreaker") codebreaker.push(p);
  const cb = codebreaker[0], cbUid = await cb.page.evaluate(() => window.__tpVault.uid());
  const lie = await guest.page.request.put(url("vt/lie/" + cbUid, await token(cb)), { data: JSON.stringify("b+1:" + pubNow.seq) });
  expect(lie.status()).toBe(401);
  // ballots are readable by their writer and the host only
  expect((await guest.page.request.get(url("vt/ballot", guestTok))).status()).toBe(401);
  expect((await guest.page.request.get(url("vt/ballot", hostTok))).status()).toBe(200);
  for (const p of P) await p.context.close();
});
