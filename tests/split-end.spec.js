/* Split Decision: End session from the Room sheet must survive a normal pause.
   Firebase is stubbed in the page. Nothing here talks to production or opens a real room. */
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const ART = "/opt/cursor/artifacts";
const ROOT = path.join(__dirname, "..");
const BASE = process.env.TIPSY_BASE || "http://127.0.0.1:8765";
fs.mkdirSync(ART, { recursive: true });

const APP = `
export function initializeApp(){ return { name: "mock" }; }
export function getApp(){ return { name: "mock" }; }
`;
const AUTH = `
export function getAuth(){
  return { currentUser: null, authStateReady(){ return Promise.resolve(); } };
}
export function signInAnonymously(){
  const uid = sessionStorage.getItem("tp_mock_uid") || "host-1";
  const user = { uid, getIdToken(){ return Promise.resolve("test-token"); } };
  return Promise.resolve({ user });
}
export function connectAuthEmulator(){}
export function setPersistence(){ return Promise.resolve(); }
export const browserLocalPersistence = {};
`;
const DB = `
const root = {};
const listeners = [];
const removes = [];
function parts(path){ return String(path || "").split("/").filter(Boolean); }
function clone(v){ return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function getNode(path){
  if (path === ".info/connected") return true;
  if (path === ".info/serverTimeOffset") return 0;
  let n = root;
  for (const p of parts(path)){
    if (n == null || typeof n !== "object" || !Object.prototype.hasOwnProperty.call(n, p)) return undefined;
    n = n[p];
  }
  return n;
}
function snap(path){
  const v = getNode(path);
  const missing = v === undefined;
  return { exists(){ return !missing; }, val(){ return missing ? null : clone(v); } };
}
function notify(path){
  listeners.slice().forEach((l) => {
    if (l.path === path || l.path.startsWith(path + "/") || path.startsWith(l.path + "/")){
      try { l.cb(snap(l.path)); } catch (e) { console.error(e); }
    }
  });
}
function setNode(path, value){
  const bits = parts(path);
  if (!bits.length) return;
  let n = root;
  for (let i = 0; i < bits.length - 1; i++){
    if (typeof n[bits[i]] !== "object" || n[bits[i]] === null) n[bits[i]] = {};
    n = n[bits[i]];
  }
  const key = bits[bits.length - 1];
  if (value === undefined) delete n[key];
  else n[key] = value;
  notify(path);
}
function readSeed(){
  try {
    const raw = sessionStorage.getItem("tp_mock_seed");
    if (!raw) return;
    const seed = JSON.parse(raw);
    Object.keys(seed).forEach((k) => setNode(k, clone(seed[k])));
  } catch (e) {}
}
readSeed();
export function ref(db, path){ return { path: path == null ? "" : String(path) }; }
export function getDatabase(){ return {}; }
export function connectDatabaseEmulator(){}
export function goOnline(){}
export function serverTimestamp(){ return Date.now(); }
export function get(r){ return Promise.resolve(snap(r.path)); }
export function set(r, value){ setNode(r.path, clone(value)); return Promise.resolve(); }
export function update(r, values){
  const base = r.path || "";
  Object.keys(values || {}).forEach((k) => {
    const full = base ? base + "/" + k : k;
    if (values[k] === null) setNode(full, undefined);
    else setNode(full, clone(values[k]));
  });
  return Promise.resolve();
}
export function remove(r){
  removes.push(r.path);
  setNode(r.path, undefined);
  return Promise.resolve();
}
export function onValue(r, cb){
  const l = { path: r.path, cb };
  listeners.push(l);
  Promise.resolve().then(() => {
    if (listeners.indexOf(l) === -1) return;
    try { cb(snap(r.path)); } catch (e) { console.error(e); }
  });
  return function(){
    const i = listeners.indexOf(l);
    if (i >= 0) listeners.splice(i, 1);
  };
}
export function onDisconnect(){
  return {
    update(){ return Promise.resolve(); },
    cancel(){ return Promise.resolve(); },
    remove(){ return Promise.resolve(); },
    set(){ return Promise.resolve(); }
  };
}
window.__tpMock = {
  removes,
  addPlayer(code, id, name){
    setNode("rooms/" + code + "/players/" + id, { name: name, connected: true, joinedAt: Date.now() });
    setNode("rooms/" + code + "/nhie/who/" + id, { emoji: "", confessions: 0, seen: 0 });
  }
};
`;

function contrast(a, b){
  const lum = (rgb) => {
    const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(Number).map((c) => {
      const x = c / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const L1 = lum(a), L2 = lum(b);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}
function htmlFiles(dir, out = []){
  for (const e of fs.readdirSync(dir, { withFileTypes: true })){
    if (["node_modules", "tests", ".git", "docs", "media"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, out);
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

async function installMock(context, prod){
  await context.route(/googletagmanager|google-analytics|analytics\.google/, (route) => route.abort());
  await context.route(/firebaseio\.com|firebasedatabase\.app|identitytoolkit|securetoken|firebaseapp\.com|gstatic\.com\/firebasejs/, (route) => {
    const url = route.request().url();
    if (url.includes("firebase-app.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: APP });
    if (url.includes("firebase-auth.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: AUTH });
    if (url.includes("firebase-database.js")) return route.fulfill({ status: 200, contentType: "text/javascript", body: DB });
    prod.push(url);
    return route.abort();
  });
}
async function openGame(browser, { width, game, name, seed, uid, reducedMotion }){
  const prod = [];
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width, height: width === 375 ? 812 : 844 },
    hasTouch: true,
    reducedMotion: reducedMotion || "no-preference"
  });
  await installMock(context, prod);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.addInitScript((bag) => {
    localStorage.setItem("tp_age_ok", "yes");
    localStorage.setItem("tp_sound", "off");
    if (bag.name) localStorage.setItem("tp_name", bag.name);
    if (bag.uid) sessionStorage.setItem("tp_mock_uid", bag.uid);
    if (bag.seed) sessionStorage.setItem("tp_mock_seed", bag.seed);
  }, { name, uid, seed });
  await page.goto(BASE + game, { waitUntil: "domcontentloaded" });
  await page.locator("#hostbtn").waitFor({ state: "visible", timeout: 15000 }).catch(async (err) => {
    const boot = await page.locator("#booterr, #offdetail").allInnerTexts().catch(() => []);
    throw new Error((boot.join(" ") || "game did not open") + " " + errors.join(" ") + " " + err.message);
  });
  return { context, page, prod, errors };
}
async function host(page, name){
  await page.locator("#pname").fill(name);
  await page.locator("#hostbtn").click();
  await expect(page.locator("#lobby")).toBeVisible();
  const code = (await page.locator("#codebig").innerText()).trim();
  expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
  return code;
}
async function removes(page){
  return page.evaluate(() => (window.__tpMock && window.__tpMock.removes.slice()) || []);
}
function shot(page, name){
  return page.screenshot({ path: path.join(ART, name), fullPage: false });
}
const endItem = (page) => page.locator("#rmsheet button.rm-item").filter({ hasText: /^End session$/ });
const confirmItem = (page) => page.locator("#rmsheet button.rm-item").filter({ hasText: /^Tap again to end$/ });

test("age line and GA tag stay on all 101 pages", () => {
  const files = htmlFiles(ROOT);
  const ga = files.filter((f) => fs.readFileSync(f, "utf8").includes("G-BHY4BXF3V3"));
  const age = files.filter((f) => fs.readFileSync(f, "utf8").includes("You must be of legal drinking age in your location."));
  expect(files.length).toBe(101);
  expect(ga.length).toBe(101);
  expect(age.length).toBe(101);
});

test("the shared Room menu still closes before it runs the action", () => {
  const ui = fs.readFileSync(path.join(ROOT, "play/room-ui.js"), "utf8");
  expect(ui).toContain('b.addEventListener("click",function(){closeSheet(); fn()});');
  expect(ui).not.toContain("Tap again to end");
  const refs = htmlFiles(ROOT).filter((f) => fs.readFileSync(f, "utf8").includes("poster-party.js"));
  expect(refs.map((f) => path.relative(ROOT, f))).toEqual(["games/split-decision.html"]);
});

test("375px: End session stays in the sheet, and remove runs once after a 4s confirm", async ({ browser }) => {
  const { context, page, prod } = await openGame(browser, { width: 375, game: "/games/split-decision.html", name: "Ada" });
  const code = await host(page, "Ada");
  await page.locator("#rmmenubtn").click();
  await expect(page.locator("#rmsheet")).toBeVisible();
  await page.locator("#rmsheet button.rm-item").filter({ hasText: "Invite friends" }).click();
  await expect(page.locator("#rminvite")).toBeVisible();
  await expect(page.locator("#rmsheet")).toBeHidden();
  expect(await removes(page)).toEqual([]);
  await page.locator("#rminviteclose").click();
  await expect(page.locator("#rminvite")).toBeHidden();

  await page.locator("#rmmenubtn").click();
  await expect(page.locator("#rmsheet")).toBeVisible();
  const first = endItem(page);
  await expect(first).toBeVisible();
  await first.scrollIntoViewIfNeeded();
  const beforeBox = await first.boundingBox();
  expect(beforeBox.height).toBeGreaterThanOrEqual(44);
  await shot(page, "split-end-menu-375.png");

  const armedAt = Date.now();
  await first.click();
  const confirm = confirmItem(page);
  await expect(confirm).toBeVisible();
  await expect(page.locator("#rmsheet")).toBeVisible();
  await expect(page.locator("#rmmenubtn")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#close")).toHaveText("End session");
  await expect(confirm).toHaveClass(/danger/);
  await expect(confirm).toHaveAttribute("aria-pressed", "true");
  const afterBox = await confirm.boundingBox();
  expect(afterBox.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(afterBox.y - beforeBox.y)).toBeLessThan(8);
  const colors = await confirm.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fg: cs.color, bg: cs.backgroundColor, font: parseFloat(cs.fontSize) };
  });
  expect(colors.font).toBeGreaterThanOrEqual(16);
  expect(contrast(colors.fg, colors.bg)).toBeGreaterThanOrEqual(4.5);
  expect(await removes(page)).toEqual([]);

  await page.waitForTimeout(4000);
  const waited = Date.now() - armedAt;
  expect(waited).toBeGreaterThanOrEqual(4000);
  expect(waited).toBeLessThan(7000);
  await expect(confirm).toBeVisible();
  await expect(page.locator("#rmsheet")).toBeVisible();
  expect(await removes(page)).toEqual([]);
  await confirm.scrollIntoViewIfNeeded();
  await shot(page, "split-end-confirm-375.png");

  await confirm.click();
  await expect(page.locator("#rmsheet")).toBeHidden();
  await expect(page.locator("#home")).toBeVisible();
  await expect(page.locator("#lobby")).toBeHidden();
  await expect(page.locator("#perr")).toHaveText("This room has closed.");
  expect(await removes(page)).toEqual(["rooms/" + code]);
  await page.locator("#perr").scrollIntoViewIfNeeded();
  await shot(page, "split-end-closed-375.png");
  expect(prod, "production Firebase was contacted").toEqual([]);
  await context.close();
});

test("390px: End session still confirms after 6s, and reduced motion stays off", async ({ browser }) => {
  const { context, page, prod } = await openGame(browser, {
    width: 390, game: "/games/split-decision.html", name: "Ada", reducedMotion: "reduce"
  });
  const code = await host(page, "Ada");
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await page.locator("#rmmenubtn").click();
  const first = endItem(page);
  await expect(first).toBeVisible();
  const armedAt = Date.now();
  await first.click();
  const confirm = confirmItem(page);
  await expect(confirm).toBeVisible();
  await expect(page.locator("#rmsheet")).toBeVisible();
  const motion = await confirm.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { transition: cs.transitionProperty, animation: cs.animationName };
  });
  expect(motion.transition).toBe("none");
  expect(motion.animation).toBe("none");
  expect(await removes(page)).toEqual([]);
  await page.waitForTimeout(6000);
  const waited = Date.now() - armedAt;
  expect(waited).toBeGreaterThanOrEqual(6000);
  expect(waited).toBeLessThan(8000);
  await expect(confirm).toBeVisible();
  expect(await removes(page)).toEqual([]);
  await confirm.scrollIntoViewIfNeeded();
  await shot(page, "split-end-confirm-390.png");
  await confirm.click();
  await expect(page.locator("#perr")).toHaveText("This room has closed.");
  expect(await removes(page)).toEqual(["rooms/" + code]);
  await page.locator("#perr").scrollIntoViewIfNeeded();
  await shot(page, "split-end-closed-390.png");
  expect(prod, "production Firebase was contacted").toEqual([]);
  await context.close();
});

test("one End session tap does not remove the room, and the row reverts", async ({ browser }) => {
  const { context, page, prod } = await openGame(browser, { width: 390, game: "/games/split-decision.html", name: "Ada" });
  await host(page, "Ada");
  await page.locator("#rmmenubtn").click();
  await endItem(page).click();
  await expect(confirmItem(page)).toBeVisible();
  expect(await removes(page)).toEqual([]);
  await page.waitForTimeout(8000);
  await expect(endItem(page)).toBeVisible({ timeout: 3000 });
  await expect(confirmItem(page)).toHaveCount(0);
  expect(await removes(page)).toEqual([]);
  await endItem(page).click();
  await expect(confirmItem(page)).toBeVisible();
  expect(await removes(page)).toEqual([]);
  expect(prod, "production Firebase was contacted").toEqual([]);
  await context.close();
});

test("the in-page End session buttons still end the room on two quick taps", async ({ browser }) => {
  const lobby = await openGame(browser, { width: 390, game: "/games/split-decision.html", name: "Ada" });
  const lobbyCode = await host(lobby.page, "Ada");
  await lobby.page.locator("#close").dispatchEvent("click");
  expect(await removes(lobby.page)).toEqual([]);
  await expect(lobby.page.locator("#perr")).toHaveText("Tap end again to close the room for everyone.");
  await lobby.page.locator("#close").dispatchEvent("click");
  await expect(lobby.page.locator("#perr")).toHaveText("This room has closed.");
  expect(await removes(lobby.page)).toEqual(["rooms/" + lobbyCode]);
  expect(lobby.prod, "production Firebase was contacted").toEqual([]);
  await lobby.context.close();

  const stage = await openGame(browser, { width: 375, game: "/games/split-decision.html", name: "Ada" });
  const code = await host(stage.page, "Ada");
  await stage.page.evaluate((room) => window.__tpMock.addPlayer(room, "player-2", "Bea"), code);
  await expect(stage.page.locator("#lobbynote")).toContainText("Tick the opt-in");
  await stage.page.locator("#optin").check();
  await expect(stage.page.locator("#start")).toBeEnabled();
  await stage.page.locator("#start").click();
  await expect(stage.page.locator("#table")).toBeVisible();
  await expect(stage.page.locator("#closestage")).toHaveText("End session");
  await stage.page.locator("#closestage").dispatchEvent("click");
  expect(await removes(stage.page)).toEqual([]);
  await expect(stage.page.locator("#perr")).toHaveText("Tap end again to close the room for everyone.");
  await stage.page.locator("#closestage").dispatchEvent("click");
  await expect(stage.page.locator("#perr")).toHaveText("This room has closed.");
  expect(await removes(stage.page)).toEqual(["rooms/" + code]);
  expect(stage.prod, "production Firebase was contacted").toEqual([]);
  await stage.context.close();
});

test("a guest Leave removes only that player", async ({ browser }) => {
  const seed = JSON.stringify({
    "rooms/TEST/meta": {
      hostUid: "someone-else", createdAt: Date.now(), status: "lobby", phase: "lobby",
      spice: "mild", rounds: 20, na: true, round: 0, gameId: 1, kind: "split"
    }
  });
  const { context, page, prod } = await openGame(browser, {
    width: 390, game: "/games/split-decision.html", name: "Bea", uid: "guest-1", seed
  });
  await page.locator("#pname").fill("Bea");
  await page.locator("#roomcode").fill("TEST");
  await page.locator("#joinbtn").click();
  await expect(page.locator("#lobby")).toBeVisible();
  await page.locator("#rmmenubtn").click();
  await expect(page.locator("#rmsheet")).toBeVisible();
  const items = await page.locator("#rmsheet button.rm-item").allInnerTexts();
  expect(items.join("|")).not.toContain("End session");
  expect(items.join("|")).not.toContain("Close room");
  await page.keyboard.press("Escape");
  const leave = page.locator("#leavebtn");
  await expect(leave).toBeVisible();
  await expect(leave).toHaveText("Leave");
  expect((await leave.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await leave.click();
  await expect(page.locator("#home")).toBeVisible();
  await expect(page.locator("#lobby")).toBeHidden();
  expect(await removes(page)).toEqual(["rooms/TEST/players/guest-1"]);
  expect(prod, "production Firebase was contacted").toEqual([]);
  await context.close();
});

test("King's Cup still closes the sheet and removes the room on the first tap", async ({ browser }) => {
  const { context, page, prod } = await openGame(browser, { width: 390, game: "/games/kings-cup.html", name: "Ada" });
  const code = await host(page, "Ada");
  await page.locator("#rmmenubtn").click();
  await expect(page.locator("#rmsheet")).toBeVisible();
  const close = page.locator("#rmsheet button.rm-item").filter({ hasText: /^Close room$/ });
  await expect(close).toBeVisible();
  await close.click();
  await expect(page.locator("#rmsheet")).toBeHidden();
  await expect.poll(async () => removes(page)).toEqual(["rooms/" + code]);
  expect(prod, "production Firebase was contacted").toEqual([]);
  await context.close();
});
