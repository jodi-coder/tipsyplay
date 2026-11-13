/* Room chrome shared by every hosted game (play/room-ui.js): Menu, Invite sheet with QR, the always-visible
   responsible-play line, and one pinned main action. Runs against the Firebase emulators, like browser.spec.js. */
const { test, expect } = require("@playwright/test");
const jsqr = require("jsqr");

const BASE = process.env.TIPSY_BASE || "http://127.0.0.1:8765";

async function boot(browser, gamePath, name) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true });
  await context.route(/googletagmanager|google-analytics|analytics\.google/, (r) => r.abort());
  const page = await context.newPage();
  await page.addInitScript((player) => {
    localStorage.setItem("tp_age_ok", "yes");
    localStorage.setItem("tp_sound", "off");
    localStorage.setItem("tp_name", player);
  }, name);
  await page.goto(BASE + gamePath + "?emulator=1", { waitUntil: "domcontentloaded" });
  await page.locator("#hostbtn").waitFor({ state: "visible" });
  return { context, page };
}
async function nameField(page) { return (await page.locator("#playername").count()) ? page.locator("#playername") : page.locator("#pname"); }
async function host(page, name) {
  await (await nameField(page)).fill(name);
  await page.locator("#hostbtn").click();
  await expect(page.locator("#lobby")).toBeVisible();
  const code = (await page.locator("#codebig").innerText()).trim();
  expect(code).toMatch(/^[A-Z]{4}$/);
  return code;
}
async function join(page, name, code) {
  await (await nameField(page)).fill(name);
  await page.locator("#roomcode").fill(code);
  await page.locator("#joinbtn").click();
  await expect(page.locator("#lobby")).toBeVisible();
}
/* true when a person could not see or tap the element: clipped away by the Menu move */
const hiddenFromUser = (loc) => loc.evaluate((e) => {
  for (let n = e; n && n !== document.body; n = n.parentElement) { if (getComputedStyle(n).clipPath !== "none") return true; if (getComputedStyle(n).display === "none") return true; }
  return false;
});
const primary = (page) => page.evaluate(() => { const e = document.querySelector(".rm-primary"); return e ? e.id : ""; });
const menuItems = async (page) => {
  await page.locator("#rmmenubtn").click();
  await expect(page.locator("#rmsheet")).toBeVisible();
  return page.locator("#rmsheet .rm-item").allInnerTexts();
};

test("lobby: one Invite, one pinned Start, the rest in the Menu, responsible-play line always there", async ({ browser }) => {
  const ada = await boot(browser, "/play/card-lottery.html", "Ada");
  const bea = await boot(browser, "/play/card-lottery.html", "Bea");
  const code = await host(ada.page, "Ada");
  await join(bea.page, "Bea", code);
  const p = ada.page;

  // the old per-game share buttons are gone from view; there is one Invite button
  await expect(p.locator(".rm-invitebtn")).toBeVisible();
  for (const sel of ["#copybtn", "#sharebtn"]) expect(await hiddenFromUser(p.locator(sel)), sel).toBe(true);
  // the host's Start is the one pinned main action and nothing covers it
  expect(await primary(p)).toBe("startbtn");
  const start = p.locator("#startbtn");
  await expect(start).toBeEnabled();
  const box = await start.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await start.evaluate((e) => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t === e || e.contains(t); })).toBe(true);
  // a guest has no Start, no Remove and no Close room
  expect(await primary(bea.page)).toBe("");
  const guestMenu = await menuItems(bea.page);
  expect(guestMenu.join("|")).toMatch(/Invite friends/);
  expect(guestMenu.join("|")).toMatch(/Sound: (on|off)/);
  expect(guestMenu.join("|")).not.toMatch(/Close room|Remove/);
  await bea.page.keyboard.press("Escape");
  // the responsible-play line is visible, links to the house code, and its link is a full-size tap target
  const strip = p.locator(".rm-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Drinking is optional");
  const link = strip.locator("a");
  await expect(link).toHaveText("Play responsibly");
  await expect(link).toHaveAttribute("href", /responsible\.html$/);
  expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
  // Invite sheet: the QR decodes to the room link, Escape closes it
  await p.locator(".rm-invitebtn").click();
  await expect(p.locator("#rminvite")).toBeVisible();
  await expect(p.locator("#rmcodebig")).toHaveText(code);
  await expect.poll(() => p.locator("#rmqr").evaluate((c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 60) k++; return k > 200; })).toBe(true);
  // wait until the code is fully drawn and readable: a half-painted canvas has dark pixels but does not decode
  let decoded = null;
  await expect.poll(async () => {
    const pixels = await p.locator("#rmqr").evaluate((c) => { const x = c.getContext("2d").getImageData(0, 0, c.width, c.height); return { w: c.width, h: c.height, data: Array.from(x.data) }; });
    decoded = jsqr(Uint8ClampedArray.from(pixels.data), pixels.w, pixels.h);
    return decoded ? decoded.data : null;
  }, { timeout: 10000 }).toContain("code=" + code);
  expect(decoded.data).toBe((await p.locator("#rmlink").innerText()).trim());
  for (const id of ["#rmshare", "#rmcopylink", "#rmcopycode", "#rminviteclose"]) {
    if (await p.locator(id).isVisible()) expect((await p.locator(id).boundingBox()).height, id).toBeGreaterThanOrEqual(44);
  }
  await p.keyboard.press("Escape");
  await expect(p.locator("#rminvite")).toBeHidden();
  // host Menu: invite, remove a player, sound, close room
  const hostMenu = (await menuItems(p)).join("|");
  expect(hostMenu).toMatch(/Invite friends/);
  expect(hostMenu).toMatch(/Remove Bea/);
  expect(hostMenu).toMatch(/Sound: (on|off)/);
  expect(hostMenu).toMatch(/Close room/);
  await p.keyboard.press("Escape");
  await ada.context.close(); await bea.context.close();
});

test("round: choices and Pass stay on screen, Reveal stays in the Menu while someone is choosing, restart card only at the end", async ({ browser }) => {
  const ada = await boot(browser, "/play/card-lottery.html", "Ada");
  const bea = await boot(browser, "/play/card-lottery.html", "Bea");
  const code = await host(ada.page, "Ada");
  await join(bea.page, "Bea", code);
  await ada.page.locator("#startbtn").click();
  await expect(ada.page.locator("#stage")).toBeVisible();
  await expect(bea.page.locator("#stage")).toBeVisible();
  for (const { page } of [ada, bea]) {
    await expect(page.getByRole("button", { name: "Red" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Black" })).toBeVisible();
    // Pass is the opt-out: it must stay visible, and it is quiet, not hidden
    const pass = page.getByRole("button", { name: /^Pass/ });
    await expect(pass).toBeVisible();
    expect((await pass.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect(page.locator(".rm-strip")).toBeVisible();
  }
  // no restart card mid-round, no Close room button on screen
  expect(await hiddenFromUser(ada.page.locator("[data-restart] button"))).toBe(true);
  expect(await hiddenFromUser(ada.page.locator("[data-act=close]").first())).toBe(true);
  // while someone is still choosing, Reveal is in the Menu, not on screen
  expect(await primary(ada.page)).toBe("");
  expect((await menuItems(ada.page)).join("|")).toMatch(/Reveal now/);
  await ada.page.keyboard.press("Escape");
  // once everyone has chosen the round reveals itself, and the host's one pinned action moves on to Next
  await ada.page.getByRole("button", { name: "Red" }).click();
  await bea.page.getByRole("button", { name: "Black" }).click();
  await expect.poll(() => primary(ada.page)).toMatch(/^(revealbtn|nextbtn|again)$/);
  expect(await primary(bea.page)).toBe("");
  if ((await primary(ada.page)) === "revealbtn") await ada.page.locator("#revealbtn").click();
  await expect.poll(() => primary(ada.page)).toMatch(/^(nextbtn|again)$/);
  await ada.context.close(); await bea.context.close();
});

test("host-paced games pin Reveal from the start, so the host never has to dig for it", async ({ browser }) => {
  const ada = await boot(browser, "/play/story-chain.html", "Ada");
  const bea = await boot(browser, "/play/story-chain.html", "Bea");
  const code = await host(ada.page, "Ada");
  await join(bea.page, "Bea", code);
  await ada.page.locator("#startbtn").click();
  await expect(ada.page.locator("#stage")).toBeVisible();
  await expect.poll(() => primary(ada.page)).toBe("revealbtn");
  await expect(ada.page.locator("#revealbtn")).toBeVisible();
  expect(await primary(bea.page)).toBe("");
  await ada.context.close(); await bea.context.close();
});

test("never have i ever: reactions and your own line live in the Menu, not on the round screen", async ({ browser }) => {
  const ada = await boot(browser, "/games/never-have-i-ever.html", "Ada");
  const bea = await boot(browser, "/games/never-have-i-ever.html", "Bea");
  const code = await host(ada.page, "Ada");
  await join(bea.page, "Bea", code);
  await ada.page.locator("#optin").check();
  await ada.page.locator("#start").click();
  await expect(ada.page.locator("#table")).toBeVisible();
  await expect(ada.page.locator("#ihave")).toBeVisible();
  await expect(ada.page.locator("#never")).toBeVisible();
  await expect(ada.page.locator("#passbtn")).toBeVisible();
  expect(await hiddenFromUser(ada.page.locator("#react"))).toBe(true);
  await expect(ada.page.locator("#mixbtn")).toHaveCount(0);
  await ada.page.locator("#rmmenubtn").click();
  await expect(ada.page.locator("#rmsheet")).toBeVisible();
  await expect(ada.page.locator("#rmsheet .rm-emo")).toHaveCount(5);
  await expect(ada.page.locator("#rmsheet #custombox")).toBeVisible();
  await ada.context.close(); await bea.context.close();
});
