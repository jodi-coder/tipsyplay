/* Theme and homepage checks. No Firebase needed.
   The page colours must come from the theme variables in styles.css, and the legal-age line must sit right under the hero. */
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const ROOT = process.env.TIPSY_ROOT || path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
const TEAL = "#0E7C7B", WHITE = "#FFFFFF", INK = "#1A1A1F", YELLOW = "#FFD60A", PINK = "#FF3D7F";

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "tests", ".git", "docs", "media"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, out); else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

test("every page and the manifest use the teal theme colour, and no old palette is left in the stylesheets", () => {
  for (const f of htmlFiles(ROOT)) {
    const s = fs.readFileSync(f, "utf8");
    if (!/<meta name="theme-color"/.test(s)) continue;
    expect(s, path.relative(ROOT, f)).toContain(`<meta name="theme-color" content="${TEAL}">`);
  }
  const m = JSON.parse(read("manifest.webmanifest"));
  expect(m.theme_color.toLowerCase()).toBe(TEAL.toLowerCase());
  expect(m.background_color.toLowerCase()).toBe(TEAL.toLowerCase());
  for (const f of ["styles.css", "home.css", "play/poster.css"]) {
    expect(read(f), f).not.toMatch(/#FAF7F2|#1A1A1F\b.*#26262E|#F5F5F0|#A8A8B3|#FF5C5C|#26262E/i);
  }
});

test("home.css has no hard-coded colours except the phone preview's pale list rows", () => {
  const hex = (read("home.css").match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toUpperCase());
  expect([...new Set(hex)]).toEqual(["#EEF6F6"]);
});

test("the theme variables hold the approved palette", async ({ page }) => {
  await page.goto("/index.html");
  const v = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim().toUpperCase();
    return { bg: g("--bg"), surface: g("--surface"), ink: g("--ink"), text: g("--text"), primary: g("--primary"), onPrimary: g("--on-primary"), danger: g("--danger"), onDanger: g("--on-danger") };
  });
  expect(v).toEqual({ bg: TEAL, surface: WHITE, ink: INK, text: WHITE, primary: YELLOW, onPrimary: INK, danger: PINK, onDanger: INK });
});

test("the homepage paints from those variables: teal page, white cards with ink text, yellow main button", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("tp_age_ok", "yes"); } catch (e) {} });
  await page.goto("/index.html");
  const c = await page.evaluate(() => {
    const css = (sel) => { const el = document.querySelector(sel); const s = getComputedStyle(el); return { bg: s.backgroundColor, fg: s.color }; };
    return { body: css("body"), card: css(".gcard3"), title: css(".gcard3 h3"), cta: css(".hero .cta") };
  });
  expect(c.body.bg).toBe(rgb(TEAL));
  expect(c.card.bg).toBe(rgb(WHITE));
  expect(c.title.fg).toBe(rgb(INK));
  expect(c.cta.bg).toBe(rgb(YELLOW));
  expect(c.cta.fg).toBe(rgb(INK));
  // changing the variable changes the page: nothing is hard-coded
  await page.addStyleTag({ content: ":root{--bg:#123456;--primary:#654321}" });
  const after = await page.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor, cta: getComputedStyle(document.querySelector(".hero .cta")).backgroundColor }));
  expect(after.body).toBe("rgb(18, 52, 86)");
  expect(after.cta).toBe("rgb(101, 67, 33)");
});

test("the legal-age line sits directly under the hero button, on the first screen", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("tp_age_ok", "yes"); } catch (e) {} });
  await page.goto("/index.html");
  const note = page.locator(".hero .safe-pill");
  await expect(note).toBeVisible();
  await expect(note).toContainText("Legal drinking age only");
  await expect(note).toContainText("Sips are optional");
  await expect(note).toContainText("Passing is always fine");
  const order = await page.evaluate(() => {
    const cta = document.querySelector(".hero .cta"), n = document.querySelector(".hero .safe-pill");
    return { next: cta.nextElementSibling === n, ctaBottom: cta.getBoundingClientRect().bottom, noteTop: n.getBoundingClientRect().top, noteBottom: n.getBoundingClientRect().bottom, feat: document.getElementById("featured").getBoundingClientRect().top, vh: innerHeight };
  });
  expect(order.next).toBe(true);
  expect(order.noteTop - order.ctaBottom).toBeLessThan(30);
  expect(order.noteBottom).toBeLessThan(order.vh);
  expect(order.noteBottom).toBeLessThan(order.feat);
});

test("the full disclaimer appears once; the cards and steps do not repeat it", async ({ page }) => {
  await page.goto("/index.html");
  const text = await page.locator("main").innerText();
  expect((text.match(/legal drinking age/gi) || []).length).toBe(2); // the hero line and the Play responsibly section
  expect(text).not.toMatch(/Non-alcoholic:/);
  await expect(page.locator("#responsible")).toContainText("Read the full responsible-play guide");
  await expect(page.locator("header.top")).toContainText("Play responsibly");
});

test("the homepage is readable when the hero preview is missing and when scripts are off", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.addStyleTag({ content: "" }).catch(() => {});
  await page.goto("/index.html");
  await page.evaluate(() => document.querySelector(".phone-wrap") && document.querySelector(".phone-wrap").remove()).catch(() => {});
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator(".hero .cta")).toBeVisible();
  await expect(page.locator(".hero .safe-pill")).toBeVisible();
  await expect(page.locator("header.top nav a", { hasText: "Play responsibly" })).toBeVisible();
  await expect(page.locator(".gcard3 .host")).toHaveCount(3);
  await ctx.close();
  // and with the preview removed in a normal page
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await c2.newPage();
  await p2.goto("/index.html");
  await p2.evaluate(() => document.querySelector(".phone-wrap").remove());
  await expect(p2.locator(".hero .cta")).toBeVisible();
  await expect(p2.locator(".hero .safe-pill")).toBeVisible();
  await c2.close();
});

test("game cards are whole-card links to the host screens, with tap targets of 44px or more", async ({ page }) => {
  await page.goto("/index.html");
  const hrefs = await page.$$eval(".gcard3 .host", (a) => a.map((x) => x.getAttribute("href")));
  expect(hrefs).toEqual(["play/card-lottery.html", "games/never-have-i-ever.html", "play/story-chain.html"]);
  const sizes = await page.$$eval(".gcard3 .host, .chips3 a, .hero .cta, .row-all .btn", (a) => a.map((x) => x.getBoundingClientRect().height));
  for (const h of sizes) expect(h).toBeGreaterThanOrEqual(43.5);
  const chips = await page.$$eval(".chips3 a", (a) => a.map((x) => x.getAttribute("href")));
  expect(chips).toEqual(["games/card/", "games/quick/", "games/for-two/", "games/big-groups/", "games/no-props/"]);
});

test("on a phone the header folds into a Menu and the Pick a game bar appears only after the hero and game list scroll away", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("tp_age_ok", "yes"); } catch (e) {} });
  await page.goto("/index.html");
  await expect(page.locator(".menu-btn")).toBeVisible();
  await expect(page.locator("header.top nav")).toBeHidden();
  await expect(page.locator("#mute")).toBeVisible();
  await expect(page.locator("#pickbar")).not.toHaveClass(/on/);
  await page.evaluate(() => document.getElementById("how").scrollIntoView());
  await expect(page.locator("#pickbar")).toHaveClass(/on/);
  await page.evaluate(() => document.getElementById("featured").scrollIntoView());
  await expect(page.locator("#pickbar")).not.toHaveClass(/on/);
  await page.click(".menu-btn");
  await expect(page.locator(".rm-sheet a", { hasText: "Favourites" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".rm-sheet")).toBeHidden();
});
