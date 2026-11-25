/* The offline list is tipsyplay-v70. v69 shipped with the catalog precache; v70 adds the vibration and reduced-motion changes.
   It keeps one copy of sounds.js, and it precaches the illustrated game catalog plus the drink
   pictures that cached pages actually show. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");

function files() {
  const body = sw.match(/const FILES=(\[[\s\S]*\]);/)[1].replace(/ver\("([^"]+)"\)/g, '"$1?v=18"');
  return JSON.parse(body.replace(/'/g, '"'));
}

const GAMES = [
  "card-lottery", "category-countdown", "five-letter-frenzy", "hot-take-court", "kings-cup",
  "never-have-i-ever", "odd-word-out", "punchline-duel", "rule-maker", "sketchy-guess",
  "slow-drip", "split-decision", "story-chain", "two-truths", "vault-traitor"
].map((name) => "images/games/" + name + ".svg");

const TYPES = ["all", "cocktails", "frozen", "hot", "party-punches", "shots"].map((name) => "images/drinks-types/" + name + ".svg");

const PHOTOS = [
  "classic-canadian-caesar", "lemon-drop-shot", "classic-rum-punch",
  "strawberry-daiquiri", "hot-toddy", "espresso-martini"
].map((name) => "images/drinks/" + name + ".webp");

function bytes(list) {
  return list.reduce((sum, rel) => sum + fs.statSync(path.join(root, rel)).size, 0);
}

test("service worker is v70 and lists each new picture once", () => {
  assert.match(sw, /const CACHE="tipsyplay-v70"/);
  assert.doesNotMatch(sw, /tipsyplay-v69/);
  const list = files();
  assert.equal(new Set(list).size, list.length, "the precache list has a duplicate");
  assert.equal(list.filter((item) => item.startsWith("sounds.js?")).length, 1);
  assert.equal(list.includes("sounds.js?v=18"), true);
  assert.equal(list.includes("sounds.js?v=19"), false);
  for (const item of GAMES.concat(TYPES, PHOTOS)) assert.equal(list.includes(item), true, item);
  assert.equal(list.filter((item) => item.startsWith("images/drinks/") && item.endsWith(".webp")).length, PHOTOS.length);
});

test("the new precache is small, and the full drink-photo set stays out", () => {
  const added = bytes(GAMES.concat(TYPES, PHOTOS));
  const allPhotos = fs.readdirSync(path.join(root, "images/drinks")).filter((name) => name.endsWith(".webp"));
  const allBytes = allPhotos.reduce((sum, name) => sum + fs.statSync(path.join(root, "images/drinks", name)).size, 0);
  assert.ok(added < 800000, "added pictures should stay under 800KB, got " + added);
  assert.ok(allPhotos.length > PHOTOS.length);
  assert.ok(allBytes > 5 * 1024 * 1024, "the full drink-photo set is the large one we left out, got " + allBytes);
  console.log("precache pictures " + added + " bytes; full drink photos " + allBytes + " bytes across " + allPhotos.length + " files");
});

test("pages ask for the same shell versions the service worker precaches", () => {
  const list = files();
  for (const item of ["styles.css?v=32", "home.css?v=17", "app.js?v=24", "play/kings-cup.js?v=34", "play/nhie-party.js?v=39", "play/frenzy-party.js?v=6"]) {
    assert.equal(list.includes(item), true, item);
  }
  const stale = /(?:styles\.css\?v=31|home\.css\?v=16|app\.js\?v=23|kings-cup\.js\?v=33|nhie-party\.js\?v=38|frenzy-party\.js\?v=5|sounds\.js\?v=19)(?!\d)/;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", "node_modules", "media", "tests"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".html") || entry.name === "sw.js" || entry.name === "build.py") {
        const text = fs.readFileSync(full, "utf8");
        assert.equal(stale.test(text), false, path.relative(root, full) + " still has an old query");
      }
    }
  }
  walk(root);
});
