/* Theme and homepage checks. No Firebase needed.
   The page colours, font and shadows must come from the theme variables in styles.css, and the 18+ line must sit right under the hero. */
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const ROOT = process.env.TIPSY_ROOT || path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
const SKY = "#7CC8FF", WHITE = "#FFFFFF", INK = "#141414", TEXT2 = "#263443", YELLOW = "#FFD60A", PINK = "#FF3D7F";

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "tests", ".git", "docs", "media"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, out); else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}
const seen = async (page) => { await page.addInitScript(() => { try { localStorage.setItem("tp_age_ok", "yes"); } catch (e) {} }); };

test("every page and the manifest use the sky-blue theme colour, and no old palette is left in the stylesheets", () => {
  for (const f of htmlFiles(ROOT)) {
    const s = fs.readFileSync(f, "utf8");
    if (!/<meta name="theme-color"/.test(s)) continue;
    expect(s, path.relative(ROOT, f)).toContain(`<meta name="theme-color" content="${SKY}">`);
  }
  const m = JSON.parse(read("manifest.webmanifest"));
  expect(m.theme_color.toLowerCase()).toBe(SKY.toLowerCase());
  expect(m.background_color.toLowerCase()).toBe(SKY.toLowerCase());
  for (const f of ["styles.css", "home.css", "play/poster.css", "manifest.webmanifest", "sw.js"]) {
    expect(read(f), f).not.toMatch(/#0E7C7B|#FAF7F2|#1A1A1F|#F0FAF9|#4A4A55|#26262E|#F5F5F0|#A8A8B3|#FF5C5C|#D3E0E0|#D6F0EF/i);
  }
});

test("the font is Bricolage Grotesque, self-hosted with its licence, and Fredoka is gone", () => {
  const css = read("styles.css");
  expect(css).toMatch(/@font-face\{font-family:"Bricolage Grotesque";[^}]*font-weight:200 800;[^}]*font-display:swap;[^}]*bricolage-grotesque-latin-opsz-normal\.woff2/);
  expect(css).toMatch(/--display:"Bricolage Grotesque",system-ui/);
  expect(css).toMatch(/--font:"Bricolage Grotesque",system-ui/);
  expect(css).not.toMatch(/Fredoka/i);
  expect(fs.existsSync(path.join(ROOT, "fonts/bricolage-grotesque-latin-opsz-normal.woff2"))).toBe(true);
  expect(read("fonts/Bricolage-Grotesque-OFL.txt")).toMatch(/SIL OPEN FONT LICENSE/);
  expect(fs.existsSync(path.join(ROOT, "fonts/fredoka-latin.woff2"))).toBe(false);
  expect(read("sw.js")).toContain("fonts/bricolage-grotesque-latin-opsz-normal.woff2");
});

test("home.css has no hard-coded colours at all", () => {
  expect(read("home.css").match(/#[0-9a-fA-F]{3,8}\b/g) || []).toEqual([]);
  expect(read("home.css")).not.toMatch(/rgba?\(/);
});

test("the theme variables hold the sky-blue palette", async ({ page }) => {
  await page.goto("/index.html");
  const v = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim().toUpperCase();
    return { bg: g("--bg"), surface: g("--surface"), ink: g("--ink"), text: g("--text"), text2: g("--text-2"), primary: g("--primary"), onPrimary: g("--on-primary"), danger: g("--danger"), onDanger: g("--on-danger"), outline: g("--outline"), bw: g("--bw"), tiles: [g("--tile-yellow"), g("--tile-pink"), g("--tile-green")] };
  });
  expect(v).toEqual({ bg: SKY, surface: WHITE, ink: INK, text: INK, text2: TEXT2, primary: YELLOW, onPrimary: INK, danger: PINK, onDanger: INK, outline: INK, bw: "2.5PX", tiles: ["#FFD60A", "#FF8FC7", "#B6F36B"] });
});

test("the homepage paints from those variables: sky page, white outlined cards with hard shadows, yellow main button", async ({ page }) => {
  await seen(page);
  await page.goto("/index.html");
  const c = await page.evaluate(() => {
    const css = (sel) => { const s = getComputedStyle(document.querySelector(sel)); return { bg: s.backgroundColor, fg: s.color, border: s.borderTopColor + " " + s.borderTopWidth, shadow: s.boxShadow, radius: s.borderTopLeftRadius, h: s.height }; };
    return { body: css("body"), pick: css(".pick"), cta: css(".hero .cta"), tile: css(".t-yellow"), badge: css(".badge18"), phone: css(".phone") };
  });
  expect(c.body.bg).toBe(rgb(SKY));
  expect(c.pick.bg).toBe(rgb(WHITE));
  expect(c.pick.fg).toBe(rgb(INK));
  expect(c.pick.border).toMatch(new RegExp("^" + rgb(INK).replace(/[()]/g, "\\$&") + " 2(\\.5)?px$")); // 2.5px; a 1x screen draws it as 2px
  expect(c.pick.shadow).toBe(rgb(INK) + " 4px 4px 0px 0px");   // hard offset, no blur
  expect(c.pick.radius).toBe("20px");
  expect(c.cta.bg).toBe(rgb(YELLOW));
  expect(c.cta.fg).toBe(rgb(INK));
  expect(c.cta.shadow).toBe(rgb(INK) + " 5px 5px 0px 0px");
  expect(c.cta.radius).toBe("18px");
  expect(c.cta.h).toBe("60px");
  expect(c.tile.bg).toBe(rgb(YELLOW));
  expect(c.badge.bg).toBe(rgb(INK));
  expect(c.phone.shadow).toBe(rgb(YELLOW) + " 8px 8px 0px 0px");
  // changing a variable changes the page: nothing is hard-coded
  await page.addStyleTag({ content: ":root{--bg:#123456;--primary:#654321}" });
  const after = await page.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor, cta: getComputedStyle(document.querySelector(".hero .cta")).backgroundColor }));
  expect(after.body).toBe("rgb(18, 52, 86)");
  expect(after.cta).toBe("rgb(101, 67, 33)");
});

test("the type scale and logo: H1 46px, weight 800, tight; logo is a lowercase word with a yellow pill", async ({ page }) => {
  await seen(page);
  await page.goto("/index.html");
  const t = await page.evaluate(() => {
    const h1 = getComputedStyle(document.querySelector("h1")), h2 = getComputedStyle(document.querySelector("#featured h2"));
    const logo = getComputedStyle(document.querySelector(".logo")), pill = getComputedStyle(document.querySelector(".logo span"));
    return { h1: [h1.fontSize, h1.fontWeight, h1.lineHeight, h1.letterSpacing, h1.fontFamily.slice(0, 22)], h2: [h2.fontSize, h2.fontWeight], logo: [logo.textTransform, logo.fontWeight], pill: [pill.backgroundColor, pill.borderTopWidth, pill.borderTopLeftRadius.length > 0], body: getComputedStyle(document.body).fontSize };
  });
  expect(t.h1.slice(0, 4)).toEqual(["46px", "800", "46px", "-1.5px"]);
  expect(t.h1[4].startsWith('"Bricolage Grotesque"')).toBe(true);
  expect(t.h2).toEqual(["30px", "800"]);
  expect(t.logo).toEqual(["lowercase", "800"]);
  expect(t.pill[0]).toBe(rgb(YELLOW));
  expect(t.pill[1]).toMatch(/^2(\.5)?px$/);
  expect(parseFloat(t.body)).toBeGreaterThanOrEqual(17);
  expect(parseFloat(t.body)).toBeLessThanOrEqual(18);
});

test("the 18+ line sits directly under the hero button, on the first screen", async ({ page }) => {
  await seen(page);
  await page.goto("/index.html");
  const note = page.locator(".hero .age-line");
  await expect(note).toBeVisible();
  await expect(note.locator(".badge18")).toHaveText("18+");
  await expect(note).toContainText("Legal drinking age only");
  await expect(note).toContainText("Drinking is optional");
  await expect(note).toContainText("Passing is always fine");
  const order = await page.evaluate(() => {
    const cta = document.querySelector(".hero .cta"), n = document.querySelector(".hero .age-line");
    return { next: cta.nextElementSibling === n, ctaBottom: cta.getBoundingClientRect().bottom, noteTop: n.getBoundingClientRect().top, noteBottom: n.getBoundingClientRect().bottom, feat: document.getElementById("featured").getBoundingClientRect().top, vh: innerHeight };
  });
  expect(order.next).toBe(true);
  expect(order.noteTop - order.ctaBottom).toBeLessThan(40);
  expect(order.noteBottom).toBeLessThan(order.vh);
  expect(order.noteBottom).toBeLessThan(order.feat);
});

test("the homepage has the spec's sections in order, with no FAQ and no FAQ data", async ({ page }) => {
  await seen(page);
  await page.goto("/index.html");
  const ids = await page.$$eval("main > section", (s) => s.map((x) => x.id));
  expect(ids).toEqual(["top", "featured", "vibe", "how", "responsible"]);
  await expect(page.locator("main h1")).toHaveText("Party games on everyone's phone.");
  await expect(page.locator(".hero .lede")).toHaveText("One person hosts, everyone joins with a code. Free, no app, no deck.");
  await expect(page.locator("#featured h2")).toHaveText("Tonight's picks");
  await expect(page.locator("#vibe h2")).toHaveText("Find your vibe");
  await expect(page.locator("#how li")).toHaveText(["1Host picks a game and gets a room code.", "2Friends join on their own phones.", "3Play. Every game has a no-drink option."]);
  await expect(page.locator("#responsible")).toContainText("Legal drinking age only. Drinking is always optional, and passing is fine. No chugging or races, and never drink and drive.");
  await expect(page.locator("#responsible a")).toHaveText("Read the full rules →");
  await expect(page.locator("#responsible a")).toHaveAttribute("href", "responsible.html");
  await expect(page.locator("footer nav a")).toHaveText(["About", "Contact", "Privacy", "Terms"]);
  await expect(page.locator("footer")).toContainText("© TipsyPlay");
  const html = read("index.html");
  expect(html).not.toMatch(/FAQPage|class="faq"|id="faq"/);
  const ld = JSON.parse(html.match(/application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const list = ld["@graph"].find((x) => x["@type"] === "ItemList");
  expect(list.itemListElement.map((i) => i.url)).toEqual(["https://tipsyplay.com/games/never-have-i-ever.html", "https://tipsyplay.com/games/hot-take-court.html", "https://tipsyplay.com/games/two-truths.html"]);
  expect(ld["@graph"].some((x) => x["@type"] === "FAQPage")).toBe(false);
});

test("the homepage is readable when the hero preview is missing and when scripts are off", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/index.html");
  await page.evaluate(() => document.querySelector(".phone-wrap") && document.querySelector(".phone-wrap").remove()).catch(() => {});
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator(".hero .cta")).toBeVisible();
  await expect(page.locator(".hero .age-line")).toBeVisible();
  await expect(page.locator("header.top nav a", { hasText: "Play responsibly" })).toBeVisible();
  await expect(page.locator(".pick")).toHaveCount(3);
  await ctx.close();
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await c2.newPage();
  await p2.goto("/index.html");
  await p2.evaluate(() => document.querySelector(".phone-wrap").remove());
  await expect(p2.locator(".hero .cta")).toBeVisible();
  await expect(p2.locator(".hero .age-line")).toBeVisible();
  await c2.close();
});

test("the picks are whole-card links with colored icon tiles, and every tap target is 44px or more", async ({ page }) => {
  await page.goto("/index.html");
  const hrefs = await page.$$eval(".pick", (a) => a.map((x) => x.getAttribute("href")));
  expect(hrefs).toEqual(["games/never-have-i-ever.html", "games/hot-take-court.html", "games/two-truths.html"]);
  const tiles = await page.$$eval(".pick .tile", (a) => a.map((x) => x.className.replace("tile ", "")));
  expect(tiles).toEqual(["t-yellow", "t-pink", "t-green"]);
  await expect(page.locator(".pick .chev")).toHaveCount(3);
  await expect(page.locator(".more")).toHaveText("See all games →");
  await expect(page.locator(".more")).toHaveAttribute("href", "games/");
  const sizes = await page.$$eval(".pick, .vibes a, .hero .cta, .more", (a) => a.map((x) => x.getBoundingClientRect().height));
  for (const h of sizes) expect(h).toBeGreaterThanOrEqual(43.5);
  const chips = await page.$$eval(".vibes a", (a) => [a.map((x) => x.textContent.trim()), a.map((x) => x.getAttribute("href"))]);
  expect(chips).toEqual([["Quick", "For 2", "Big groups", "No props", "Cards"], ["games/quick/", "games/for-two/", "games/big-groups/", "games/no-props/", "games/card/"]]);
});

test("on a phone the header folds into a Menu and the Pick a game bar appears only after the hero and the picks scroll away", async ({ page }) => {
  await seen(page);
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

test("on desktop the nav links sit inline and there is no Menu button", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem("tp_age_ok", "yes"); } catch (e) {} });
  await page.goto("/index.html");
  await expect(page.locator(".menu-btn")).toBeHidden();
  await expect(page.locator("header.top nav a")).toHaveText(["Games", "Blog", "Party spots", "Play responsibly"]);
  await ctx.close();
});

/* A white surface only reads correctly if it is in the white-surface scope in styles.css, which turns the text ink.
   Any rule that paints var(--surface) must be in that list, sit inside something that is, or set its own ink text. */
const NO_TEXT_OF_THEIR_OWN = [".hero-photo", ".shot", ".kc-lights i", ".spot-hero", ".pscreens", ".vt-peg.miss i"]; // images, light bars, the phone-preview screen (its text sets ink), Vault Traitor peg dots
test("every rule that paints a white surface is in the white-surface scope", () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "");
  const css = strip(read("styles.css"));
  const scopeMatch = css.match(/([^{}]+)\{[^{}]*--text:var\(--ink\)[^{}]*--text-2:var\(--ink-2\)[^{}]*\}/);
  expect(scopeMatch, "scope rule not found").toBeTruthy();
  const norm = (t) => t.replace(/\s+/g, " ").trim();
  const splitSel = (t) => t.split(/,(?![^(]*\))/).map(norm);
  const scope = splitSel(scopeMatch[1]);
  const lead = (sel) => sel.split(/[ >+~]/)[0];
  const sources = [css, ...htmlFiles(path.join(ROOT, "games")).map((f) => strip(fs.readFileSync(f, "utf8"))), strip(read("play/poster.css")), strip(read("home.css"))];
  const bad = [];
  for (const src of sources) {
    for (const m of src.matchAll(/([^{}<]+)\{([^{}]*background:var\(--surface\)[^{}]*)\}/g)) {
      if (/color:var\(--ink\)|--text:var\(--ink\)|color:var\(--on-/.test(m[2])) continue;
      for (const sel of splitSel(m[1])) {
        const bare = sel.replace(/^body\.[\w-]+(\[[^\]]*\])?\s+/, "");
        const ok = scope.includes(sel) || scope.includes(bare) || scope.includes(lead(bare)) || scope.includes(bare.replace(/\.[\w-]+$/, "")) ||
          NO_TEXT_OF_THEIR_OWN.includes(bare) || /^(html|body|:root)/.test(sel);
        if (!ok) bad.push(sel);
      }
    }
  }
  expect([...new Set(bad)], "white surfaces outside the scope: add them to the list in styles.css").toEqual([]);
});
