/* Theme and homepage checks. No Firebase needed.
   The page colours, font and shadows must come from the theme variables in styles.css (the midnight nightlife palette). */
const { test, expect } = require("./harness");
const fs = require("fs");
const path = require("path");
const ROOT = process.env.TIPSY_ROOT || path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
const NIGHT = "#0D0F1A", CARD = "#16192B", INK = "#F4F5FA", TEXT2 = "#A9AEC6", CORAL = "#FF5A5F", AMBER = "#FFB020", INDIGO = "#5E5CE6";
const LINE = "rgba(255, 255, 255, 0.1)";
const fresh = async (browser, vp = { width: 390, height: 844 }) => { const ctx = await browser.newContext({ viewport: vp }); return { ctx, page: await ctx.newPage() }; };

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "tests", ".git", "docs", "media"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, out); else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}
const seen = async (page) => { await page.addInitScript(() => { try { localStorage.setItem("tp_age_ok", "yes"); } catch (e) {} }); };

test("every page and the manifest use the midnight theme colour, and no old palette is left in the stylesheets", () => {
  for (const f of htmlFiles(ROOT)) {
    const s = fs.readFileSync(f, "utf8");
    if (!/<meta name="theme-color"/.test(s)) continue;
    expect(s, path.relative(ROOT, f)).toContain(`<meta name="theme-color" content="${NIGHT}">`);
  }
  const m = JSON.parse(read("manifest.webmanifest"));
  expect(m.theme_color.toUpperCase()).toBe(NIGHT);
  expect(m.background_color.toUpperCase()).toBe(NIGHT);
  for (const f of ["styles.css", "home.css", "play/poster.css", "manifest.webmanifest", "sw.js"]) {
    expect(read(f), f).not.toMatch(/#0E7C7B|#FAF7F2|#1A1A1F|#F0FAF9|#4A4A55|#26262E|#F5F5F0|#A8A8B3|#FF5C5C|#D3E0E0|#D6F0EF|#7CC8FF|#FFD60A/i);
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

test("the theme variables hold the midnight nightlife palette", async ({ page }) => {
  await page.goto("/index.html");
  const v = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim().toUpperCase();
    return { bg: g("--bg"), surface: g("--surface"), ink: g("--ink"), text: g("--text"), text2: g("--text-2"), coral: g("--coral"), amber: g("--amber"), indigo: g("--indigo"), primary: g("--primary"), onPrimary: g("--on-primary"), danger: g("--danger"), line: g("--line").replace(/\s/g, ""), bw: g("--bw") };
  });
  expect(v).toEqual({ bg: NIGHT, surface: CARD, ink: INK, text: INK, text2: TEXT2, coral: CORAL, amber: AMBER, indigo: INDIGO, primary: CORAL, onPrimary: NIGHT, danger: AMBER, line: "RGBA(255,255,255,.1)", bw: "1PX" });
});

test("the homepage paints from those variables: midnight page, slate cards with white/10 borders, coral main button", async ({ page }) => {
  await seen(page);
  await page.goto("/index.html");
  const c = await page.evaluate(() => {
    const css = (sel) => { const s = getComputedStyle(document.querySelector(sel)); return { bg: s.backgroundColor, img: s.backgroundImage, fg: s.color, border: s.borderTopColor + " " + s.borderTopWidth, radius: s.borderTopLeftRadius }; };
    return { body: css("body"), card: css(".gc"), cta: css(".hero .cta"), join: css(".joinbox") };
  });
  expect(c.body.bg).toBe(rgb(NIGHT));
  expect(c.card.bg).toBe(rgb(CARD));
  expect(c.card.fg).toBe(rgb(INK));
  expect(c.card.border).toMatch(/ 1px$/);
  expect(c.card.radius).toBe("22px");
  expect(c.join.border).toBe(LINE + " 1px");
  expect(c.cta.bg).toBe(rgb(CORAL));
  expect(c.cta.img).toContain("linear-gradient");
  expect(c.cta.fg).toBe(rgb(NIGHT));
  // changing a variable changes the page: nothing is hard-coded
  await page.addStyleTag({ content: ":root{--bg:#123456;--amber:#654321}" });
  const after = await page.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor, badge: getComputedStyle(document.querySelector(".gc-new")).backgroundColor }));
  expect(after.body).toBe("rgb(18, 52, 86)");
  expect(after.badge).toBe("rgb(101, 67, 33)");
});

test("the type scale and logo: a bold display hero, weight 800, tight; logo is a lowercase word with a coral pill", async ({ page }) => {
  await seen(page);
  await page.goto("/index.html");
  const t = await page.evaluate(() => {
    const h1 = getComputedStyle(document.querySelector("h1")), h2 = getComputedStyle(document.querySelector("#vibe h2"));
    const logo = getComputedStyle(document.querySelector(".logo")), pill = getComputedStyle(document.querySelector(".logo span"));
    return { h1: [h1.fontSize, h1.fontWeight, h1.letterSpacing, h1.fontFamily.slice(0, 22)], h2: [h2.fontSize, h2.fontWeight], logo: [logo.textTransform, logo.fontWeight], pill: pill.backgroundColor, body: getComputedStyle(document.body).fontSize };
  });
  expect(parseFloat(t.h1[0])).toBeGreaterThanOrEqual(44);
  expect(t.h1.slice(1, 3)).toEqual(["800", "-2px"]);
  expect(t.h1[3].startsWith('"Bricolage Grotesque"')).toBe(true);
  expect(t.h2).toEqual(["30px", "800"]);
  expect(t.logo).toEqual(["lowercase", "800"]);
  expect(t.pill).toBe(rgb(CORAL));
  expect(parseFloat(t.body)).toBeGreaterThanOrEqual(17);
  expect(parseFloat(t.body)).toBeLessThanOrEqual(18);
});

test("the hero: headline, lede, a Pick a Game button, the inline room code box, and the try-it phone", async ({ page }) => {
  await seen(page);
  await page.goto("/index.html");
  await expect(page.locator(".hero .lede")).toContainText("Drinking is optional.");
  const cta = page.locator(".hero .cta");
  await expect(cta).toHaveText("Pick a Game");
  await expect(cta).toHaveAttribute("href", "games/");
  await expect(cta).toHaveAttribute("data-gate", "");
  const box = await page.locator(".joinbox").boundingBox();
  expect(box.y + box.height).toBeLessThan(844);
  await expect(page.locator("#joincode")).toHaveAttribute("maxlength", "4");
  await expect(page.locator(".hero-side .phone")).toBeVisible();
  await expect(page.locator("#demo [role=tab]")).toHaveText(["Lobby", "Round 3", "Results"]);
});

test("on desktop the hero is two columns; on a phone it stacks", async ({ browser }) => {
  for (const [vp, side] of [[{ width: 1280, height: 900 }, true], [{ width: 390, height: 844 }, false]]) {
    const { ctx, page } = await fresh(browser, vp);
    await page.goto("/index.html");
    const a = await page.locator(".hero-copy").boundingBox(), b = await page.locator(".hero-side").boundingBox();
    if (side) { expect(b.x).toBeGreaterThan(a.x + a.width - 1); expect(Math.abs(a.y - b.y)).toBeLessThan(300); }
    else expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
    const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(over).toBe(false);
    await ctx.close();
  }
});

test("the try-it phone: answering I HAVE, NEVER or Pass locks in and moves to the Results", async ({ page }) => {
  await seen(page);
  await page.goto("/index.html");
  await page.locator("#demo").scrollIntoViewIfNeeded();
  for (const [btn, label] of [[".ph-have", "I HAVE"], [".ph-never", "Never"], [".ph-pass", "Passed"]]) {
    await page.click("#dt-round");
    if (await page.locator(btn).isDisabled()) await page.click("#dm-next");
    await page.click(btn);
    await expect(page.locator(btn)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#dm-avatars li.me.in")).toHaveCount(1);
    await expect(page.locator("#dt-results")).toHaveAttribute("aria-selected", "true", { timeout: 8000 });
    await expect(page.locator("#dm-haves li").first()).toContainText(label);
    await page.click("#dm-next");
  }
  await page.click("#dt-lobby");
  await expect(page.locator("#dp-lobby")).toBeVisible();
  await expect(page.locator("#dm-plist li")).toHaveCount(5);
});

test("the homepage has the spec's sections in order, including the FAQ", async ({ page }) => {
  await seen(page);
  await page.goto("/index.html");
  const ids = await page.$$eval("main > section", (s) => s.map((x) => x.id));
  expect(ids).toEqual(["top", "vibe", "how", "drinks", "faq", "responsible"]);
  await expect(page.locator("main h1")).toHaveText("Party games on everyone's phone.");
  await expect(page.locator(".hero .lede")).toHaveText("One person hosts, everyone joins with a code. Free, no app, no deck. Drinking is optional.");
  await expect(page.locator("#vibe h2")).toHaveText("Find your vibe");
  await expect(page.locator("#how li")).toHaveText(["1Host picks a game and gets a room code.", "2Friends join on their own phones.", "3Play. Every game has a no-drink option."]);
  await expect(page.locator("#responsible")).toContainText("Legal drinking age only. Drinking is always optional, and passing is fine. No chugging or races, and never drink and drive.");
  await expect(page.locator("#responsible a")).toHaveText("Read the full rules →");
  await expect(page.locator("#responsible a")).toHaveAttribute("href", "responsible.html");
  await expect(page.locator("footer nav a")).toHaveText(["About", "Contact", "Privacy", "Terms"]);
  await expect(page.locator("footer")).toContainText("© TipsyPlay");
  const html = read("index.html");
  const ld = JSON.parse(html.match(/application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage");
  const visible = await page.$$eval("#faq details", (ds) => ds.map((d) => [d.querySelector("summary").textContent.trim(), d.querySelector("p").textContent.trim()]));
  expect(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(visible);
  expect(visible[3][1]).toBe("Adults only. You must be of legal drinking age in your location.");
  const sums = await page.$$eval("#faq summary", (els) => els.map((el) => el.getBoundingClientRect().height));
  for (const h of sums) expect(h).toBeGreaterThanOrEqual(44);
});

test("the homepage is readable when scripts are off: every game card and link is there", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/index.html");
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator(".joinbox")).toBeVisible();
  await expect(page.locator("header.top nav a", { hasText: "Play responsibly" })).toBeVisible();
  await expect(page.locator(".gc")).toHaveCount(15);
  await expect(page.locator("#dp-round")).toBeVisible(); // the phone shows the round without its tabs working
  await ctx.close();
});

test("the illustrated catalog: art, player badges, vibe tags, one NEW badge on Slow Drip, Zero-Drink Friendly markers", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator(".gc")).toHaveCount(15);
  const imgs = await page.$$eval(".gc .gc-art img", (a) => a.map((i) => i.getAttribute("src")));
  expect(imgs).toHaveLength(15);
  for (const src of imgs) { expect(src).toMatch(/^images\/games\/[a-z-]+\.svg$/); expect(fs.existsSync(path.join(ROOT, src)), src).toBe(true); }
  await expect(page.locator(".gc .gc-art .gc-players")).toHaveCount(15);
  await expect(page.locator(".gc .gc-play")).toHaveCount(15);
  for (const t of await page.locator(".gc-players").allTextContents()) expect(t).toMatch(/^\d+–\d+ players$/);
  await expect(page.locator(".gc-new")).toHaveCount(1);
  await expect(page.locator(".gc", { has: page.locator(".gc-new") }).locator(".gc-name")).toHaveText("Slow Drip");
  await expect(page.locator(".gc", { hasText: "Never Have I Ever" }).locator(".gc-players")).toHaveText("2–12 players");
  const zero = await page.locator(".gc", { has: page.locator(".gc-zero") }).locator(".gc-name").allTextContents();
  expect(zero.sort()).toEqual(["Five Letter Frenzy", "Sketchy Guess", "Split Decision", "Two Truths & a Twist"]);
  for (const n of await page.$$eval(".gc", (a) => a.map((x) => x.querySelectorAll(".gc-vibe").length))) expect(n).toBeGreaterThanOrEqual(1);
});

test("Find your vibe pills filter the catalog in place, and fall back to the category pages", async ({ page }) => {
  await page.goto("/index.html");
  const chips = await page.$$eval("#vibes a", (a) => [a.map((x) => x.textContent.trim()), a.map((x) => x.getAttribute("href"))]);
  expect(chips).toEqual([["All", "Quick", "For 2", "Big Groups", "No Props", "Cards"], ["games/", "games/quick/", "games/for-two/", "games/big-groups/", "games/no-props/", "games/card/"]]);
  const names = () => page.$$eval(".gc:not([hidden])", (a) => a.map((x) => x.querySelector(".gc-name").textContent));
  await page.click("#vibes [data-filter=two]");
  await expect(page).toHaveURL(/index\.html(?:\?.*)?$/);
  await expect(page.locator("#vibes [data-filter=two]")).toHaveAttribute("aria-pressed", "true");
  expect((await names()).sort()).toEqual(["Card Lottery", "King's Cup", "Never Have I Ever", "Split Decision"]);
  await page.click("#vibes [data-filter=cards]");
  expect((await names()).sort()).toEqual(["Card Lottery", "King's Cup", "Rule Maker"]);
  await page.click("#vibes [data-filter=quick]");
  expect(await names()).not.toContain("Sketchy Guess");
  await page.click("#vibes [data-filter=no-props]");
  expect(await names()).not.toContain("King's Cup");
  await page.click("#vibes [data-filter=big]");
  expect(await names()).not.toContain("Hot Take Court");
  await page.click("#vibes [data-filter=all]");
  await expect(page.locator("#gcount")).toHaveText("15 games");
  // phones fold the full list after six, behind one button
  await expect(page.locator(".gc:visible")).toHaveCount(6);
  await page.click("#catmore");
  await expect(page.locator(".gc:visible")).toHaveCount(15);
  const sizes = await page.$$eval("#vibes a, .more, .joinrow input, .joinrow .btn, .hero .cta", (a) => a.map((x) => x.getBoundingClientRect().height));
  for (const h of sizes) expect(h).toBeGreaterThanOrEqual(43.5);
  const drinks = await page.$$eval("#drinks .vibes a", (a) => a.map((x) => x.getAttribute("href")));
  expect(drinks).toEqual(["drinks/shots/", "drinks/cocktails/", "drinks/party-punches/", "drinks/frozen/", "drinks/hot/"]);
});

test("age gate is deferred: browsing opens nothing, playing asks first", async ({ browser }) => {
  let { ctx, page } = await fresh(browser);
  await page.goto("/index.html");
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator("#gate")).toHaveCount(0);
  await page.click(".hero .cta");
  await expect(page.locator("#gate [role=dialog]")).toBeVisible();
  await expect(page.locator("#gate")).toContainText("You must be of legal drinking age in your location.");
  await page.keyboard.press("Escape");
  await expect(page.locator("#gate")).toHaveCount(0);
  await expect(page).toHaveURL(/index\.html(?:\?.*)?$/);
  await page.fill("#joincode", "kqxj");
  await page.press("#joincode", "Enter");
  await expect(page.locator("#gate")).toBeVisible();
  await page.click("#gyes");
  await expect(page).toHaveURL(/play\/go\.html\?room=KQXJ/);
  await ctx.close();
  ({ ctx, page } = await fresh(browser));
  await page.goto("/games/index.html");
  await expect(page.locator("#gate")).toHaveCount(0);
  await page.locator("#slow-drip a.btn").click();
  await expect(page.locator("#gate")).toBeVisible();
  await page.click("#gno");
  await expect(page.locator("#gmsg")).toBeVisible();
  await page.click("#gback");
  await expect(page.locator("#gate")).toHaveCount(0);
  await page.goto("/index.html");
  await page.click(".hero .cta");
  await page.click("#gyes");
  await expect(page).toHaveURL(/\/games\/(?:\?.*)?$/);
  await page.goto("/index.html");
  await page.click(".hero .cta");
  await expect(page).toHaveURL(/\/games\/(?:\?.*)?$/); // remembered: no second ask
  await ctx.close();
  ({ ctx, page } = await fresh(browser));
  await page.goto("/play/party.html");
  await expect(page.locator("#gate")).toBeVisible(); // a game screen still asks on load
  await page.keyboard.press("Escape");
  await expect(page.locator("#gate")).toBeVisible();
  await ctx.close();
});

test("the Never Have I Ever round screen has the controller bar and a quiet Pass (No Drink) pill", async ({ page }) => {
  const html = read("games/never-have-i-ever.html");
  for (const id of ["ctlbar", "ctlcode", "ctlround", "ctlfill", "ctlavatars", "ctlmenu"]) expect(html, id).toContain(`id="${id}"`);
  expect(html).toContain('<button type="button" class="btn alt" id="passbtn">Pass (No Drink)</button>');
  expect(html).toMatch(/100dvh/);
  const js = read("play/nhie-party.js");
  expect(js).toMatch(/function paintBar\(/);
  expect(js).toMatch(/\$\("ctlcode"\)\.addEventListener\("click"/);
});

test("on a phone the header folds into a Menu", async ({ page }) => {
  await seen(page);
  await page.goto("/index.html");
  await expect(page.locator(".menu-btn")).toBeVisible();
  await expect(page.locator("header.top nav")).toBeHidden();
  await expect(page.locator("#mute")).toBeVisible();
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
  await expect(page.locator("header.top nav a")).toHaveText(["Games", "Drinks", "Blog", "Party spots", "Play responsibly"]);
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

test("the hero join box sends the code to the join page", async ({ page }) => {
  await seen(page);
  await page.goto("/index.html");
  const form = page.locator(".hero form.joinbox");
  await expect(form).toBeVisible();
  await expect(form).toHaveAttribute("action", "play/go.html");
  await expect(form.locator("input")).toHaveAttribute("name", "room");
    await form.locator("input").fill("kqxj");
  await form.locator("button").click();
  await expect(page).toHaveURL(/play\/go\.html\?room=kqxj/i);
});
