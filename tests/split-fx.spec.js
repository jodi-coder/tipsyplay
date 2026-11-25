/* Split Decision video moments are an enhancement only.
   Clips load only when their phase starts; a missing clip falls back to its still, a missing still
   hides the strip; reduced motion and slow connections never load video. Uses the Firebase emulator. */
const { test, expect } = require("./harness");

const BASE = process.env.TIPSY_BASE || "http://127.0.0.1:8765";
const GAME = "/games/split-decision.html";
// 1x1 PNG served as the still: browsers sniff the bytes, so the .jpg URL still loads.
const STILL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==", "base64");

async function boot(browser, name, opts){
  const o = opts || {};
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: o.reducedMotion || "no-preference" });
  await context.route(/googletagmanager|google-analytics|analytics\.google/, (route) => route.abort());
  const video = [];
  await context.route(/\/assets\/video\//, (route) => {
    const url = route.request().url();
    video.push(url.replace(/^.*\/assets\/video\//, ""));
    if (o.stills && /\.jpg$/.test(url)) return route.fulfill({ status: 200, contentType: "image/jpeg", body: STILL });
    return route.fulfill({ status: 404, body: "" });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((bag) => {
    localStorage.setItem("tp_age_ok", "yes");
    localStorage.setItem("tp_sound", "off");
    localStorage.setItem("tp_name", bag.name);
    if (bag.connection) Object.defineProperty(navigator, "connection", { configurable: true, get: () => bag.connection });
  }, { name, connection: o.connection || null });
  await page.goto(BASE + GAME + "?emulator=1", { waitUntil: "domcontentloaded" });
  await page.locator("#hostbtn").waitFor({ state: "visible" });
  return { context, page, video, errors };
}
async function startPair(browser, opts){
  const host = await boot(browser, "Ada", opts);
  const guest = await boot(browser, "Bea");
  await host.page.locator("#pname").fill("Ada");
  await host.page.locator("#hostbtn").click();
  await expect(host.page.locator("#lobby")).toBeVisible();
  const code = (await host.page.locator("#codebig").innerText()).trim();
  await guest.page.locator("#roomcode").fill(code);
  await guest.page.locator("#joinbtn").click();
  await expect(guest.page.locator("#lobby")).toBeVisible();
  await host.page.waitForTimeout(500);
  // Home and lobby never touch the clips.
  expect(host.video).toEqual([]);
  await host.page.locator("#optin").check();
  await host.page.locator("#start").click();
  await expect(host.page.locator(".poster-choice").first()).toBeVisible();
  return { host, guest };
}
async function playRound(host, guest){
  await host.page.locator(".poster-choice", { hasText: /^A ·/ }).click();
  await guest.page.locator(".poster-choice", { hasText: /^B ·/ }).click();
  await host.page.locator(".poster-choice", { hasText: /^0$/ }).click();
  await guest.page.locator(".poster-choice", { hasText: /^1$/ }).click();
  await expect(host.page.locator(".sd-me")).toBeVisible({ timeout: 20000 });
}
async function close(...ps){ for (const p of ps) await p.context.close(); }

test("missing clips and stills: the strip stays hidden and the round still plays with CSS animation", async ({ browser }) => {
  const { host, guest } = await startPair(browser);
  await expect(host.page.locator("#sdfx")).toHaveAttribute("data-media", "none");
  await expect(host.page.locator("#sdfx")).toBeHidden();
  expect(host.video).toEqual(expect.arrayContaining(["tension-loop.webm", "tension-loop.jpg"]));
  await playRound(host, guest);
  await expect(host.page.locator("#sdfx")).toHaveAttribute("data-media", "none");
  expect(host.video).toEqual(expect.arrayContaining(["reveal-burst.webm", "reveal-burst.jpg"]));
  const anim = await host.page.locator(".sd-me").evaluate((n) => getComputedStyle(n).animationName);
  expect(anim).toBe("sdIn");
  expect(host.errors).toEqual([]);
  await close(host, guest);
});

test("a missing clip falls back to its still image", async ({ browser }) => {
  const { host, guest } = await startPair(browser, { stills: true });
  await expect(host.page.locator("#sdfx")).toHaveAttribute("data-media", "still");
  await expect(host.page.locator("#sdfx img")).toBeVisible();
  await expect(host.page.locator("#sdfx video")).toHaveCount(0);
  expect(host.video).toContain("tension-loop.webm");
  expect(host.video).toContain("tension-loop.jpg");
  expect(host.errors).toEqual([]);
  await close(host, guest);
});

test("the video element is muted, inline and looping when the connection allows it", async ({ browser }) => {
  const host = await boot(browser, "Ada", { connection: { effectiveType: "4g", saveData: false } });
  await host.page.evaluate(() => {
    document.getElementById("app").classList.remove("hide");
    document.getElementById("table").classList.remove("hide");
    window.SplitFX.show("tension-loop");
  });
  const v = host.page.locator("#sdfx video");
  await expect(v).toHaveCount(1);
  expect(await v.evaluate((n) => [n.muted, n.loop, n.playsInline, n.hasAttribute("playsinline"), Array.from(n.querySelectorAll("source")).map((s) => s.type)]))
    .toEqual([true, true, true, true, ["video/webm", "video/mp4"]]);
  await close(host);
});

test("reduced motion shows only the still, with no video and no motion", async ({ browser }) => {
  const { host, guest } = await startPair(browser, { stills: true, reducedMotion: "reduce" });
  await expect(host.page.locator("#sdfx")).toHaveAttribute("data-media", "still");
  await expect(host.page.locator("#sdfx video")).toHaveCount(0);
  await playRound(host, guest);
  await expect(host.page.locator("#sdfx")).toHaveAttribute("data-media", "still");
  expect(host.video.filter((u) => /\.(webm|mp4)$/.test(u))).toEqual([]);
  // No staged animation and no count-up: the final numbers are there at once.
  expect(await host.page.locator(".sd-me").evaluate((n) => getComputedStyle(n).animationName)).toBe("none");
  expect(await host.page.locator(".sd-badge.big").evaluate((n) => getComputedStyle(n).animationName)).toBe("none");
  await expect(host.page.locator(".sd-me-num")).toHaveText("+2");
  expect(host.errors).toEqual([]);
  await close(host, guest);
});

for (const [label, connection] of [["3g", { effectiveType: "3g", saveData: false }], ["Save-Data", { effectiveType: "4g", saveData: true }]]) {
  test("a slow connection (" + label + ") shows the still and never requests video", async ({ browser }) => {
    const { host, guest } = await startPair(browser, { stills: true, connection });
    await expect(host.page.locator("#sdfx")).toHaveAttribute("data-media", "still");
    await playRound(host, guest);
    expect(host.video.filter((u) => /\.(webm|mp4)$/.test(u))).toEqual([]);
    expect(host.video).toEqual(expect.arrayContaining(["tension-loop.jpg", "reveal-burst.jpg"]));
    expect(host.errors).toEqual([]);
    await close(host, guest);
  });
}

test("the service worker never caches clips", () => {
  const sw = require("fs").readFileSync(require("path").join(__dirname, "..", "sw.js"), "utf8");
  expect(sw).toMatch(/isVideo\(e\.request\.url\)/);
  expect(sw).not.toMatch(/assets\/video\/[a-z-]+\.(webm|mp4|jpg)/);
});
