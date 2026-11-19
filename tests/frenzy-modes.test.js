/* Five Letter Frenzy: the Solo and Race rules. Run: node --test frenzy-modes.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../play/frenzy-modes.js");
const L = require("../play/frenzy-logic.js");
const W = require("../data/frenzy-words.js");

/* ---------- colours (the same function Solo and Table use) ---------- */
test("colours: ABBEY against ABBAS, repeated letters, and a letter that is in the secret once", () => {
  assert.deepEqual(L.markGuess("abbas", "abbey"), ["locked", "locked", "locked", "absent", "absent"]);
  assert.deepEqual(L.markGuess("abbey", "abbas"), ["locked", "locked", "locked", "absent", "absent"]);
  assert.deepEqual(L.markGuess("crane", "eerie"), ["absent", "absent", "moved", "absent", "locked"]);
  // two a's in the guess, one in the secret: the first a moves, the second finds none left
  assert.deepEqual(L.markGuess("crane", "naval"), ["moved", "moved", "absent", "absent", "absent"]);
  assert.deepEqual(L.markGuess("alley", "llama"), ["moved", "locked", "moved", "absent", "absent"]);
  assert.deepEqual(L.markGuess("books", "ooooo"), ["absent", "locked", "locked", "absent", "absent"]);
  assert.deepEqual(L.markGuess("abbey", "babes"), ["moved", "moved", "locked", "locked", "absent"]);
});

/* ---------- the daily word ---------- */
test("daily word: the same date always gives the same word, and it changes from day to day", () => {
  const a = W.answers;
  assert.equal(M.dailyWord("2026-11-19", a), M.dailyWord("2026-11-19", a));
  assert.ok(a.includes(M.dailyWord("2026-11-19", a)));
  const days = new Set();
  for (let d = 1; d <= 60; d++) days.add(M.dailyWord("2026-12-" + String(d % 28 + 1).padStart(2, "0") + "x" + d, a));
  assert.ok(days.size > 45, "60 different dates give mostly different words");
  assert.equal(M.dailyWord("2026-11-19", []), "");
  assert.equal(M.dateKey(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(M.dateKey(new Date(2026, 10, 19)), "2026-11-19");
});
test("daily word: spread across the whole list", () => {
  const seen = new Set();
  for (let i = 0; i < 1500; i++) seen.add(M.dailyIndex("day-" + i, W.answers.length));
  assert.ok(seen.size > 800);
  for (const x of seen) assert.ok(x >= 0 && x < W.answers.length);
});

/* ---------- Solo stats ---------- */
test("solo stats: played, win percentage, streak, best streak and the guess distribution", () => {
  let s = M.newStats();
  assert.equal(M.winPct(s), 0);
  s = M.applyResult(s, true, 3);
  s = M.applyResult(s, true, 4);
  s = M.applyResult(s, true, 3);
  assert.deepEqual({ p: s.played, w: s.wins, st: s.streak, b: s.best, l: s.lost }, { p: 3, w: 3, st: 3, b: 3, l: 0 });
  assert.deepEqual(s.dist, [0, 0, 2, 1, 0, 0]);
  s = M.applyResult(s, false);
  assert.equal(s.streak, 0); assert.equal(s.best, 3); assert.equal(s.lost, 1); assert.equal(s.played, 4);
  assert.equal(M.winPct(s), 75);
  s = M.applyResult(s, true, 6);
  assert.equal(s.streak, 1); assert.equal(s.best, 3); assert.equal(s.dist[5], 1);
  for (let i = 0; i < 4; i++) s = M.applyResult(s, true, 1);
  assert.equal(s.streak, 5); assert.equal(s.best, 5); assert.equal(s.dist[0], 4);
  const total = s.dist.reduce((a, b) => a + b, 0) + s.lost;
  assert.equal(total, s.played, "the distribution and the losses add up to the games played");
});
test("solo stats: applying a result never changes the old object, and bad saved data is cleaned", () => {
  const a = M.newStats(), b = M.applyResult(a, true, 2);
  assert.equal(a.played, 0); assert.equal(b.played, 1);
  assert.deepEqual(M.cleanStats(null), M.newStats());
  assert.deepEqual(M.cleanStats("junk"), M.newStats());
  const c = M.cleanStats({ played: "x", wins: -3, streak: 4, best: 1, dist: [1, "a", null, 2], lost: 9.7 });
  assert.equal(c.played, 0); assert.equal(c.wins, 0); assert.equal(c.best, 4, "best is never below the streak");
  assert.deepEqual(c.dist, [1, 0, 0, 2, 0, 0]); assert.equal(c.lost, 9);
  assert.equal(M.applyResult({ played: 1, wins: 1, streak: 1, best: 1, dist: [1] }, true, 2).dist.length, 6);
});

/* ---------- the result card ---------- */
test("result card: an emoji grid with shapes and colours only, never a letter", () => {
  const rows = [L.markGuess("crane", "house"), L.markGuess("crane", "crate"), L.markGuess("crane", "crane")];
  const grid = M.emojiGrid(rows);
  assert.equal(grid, "⬛⬛⬛⬛🟨\n🟨🟨🟨⬛🟨\n🟨🟨🟨🟨🟨");
  const text = M.shareText("Daily", "2026-11-19", true, rows);
  assert.match(text, /^Five Letter Frenzy Daily 2026-11-19 3\/6\n\n/);
  assert.ok(text.endsWith("tipsyplay.com/games/five-letter-frenzy.html"));
  assert.ok(!/crane|house|crate/i.test(text), "no guess and no secret word");
  const lost = M.shareText("Random", "x", false, [rows[0], rows[0], rows[0], rows[0], rows[0], rows[0]]);
  assert.match(lost, /^Five Letter Frenzy Random X\/6/);
  const moved = M.emojiGrid([["moved", "absent", "locked", "moved", "absent"]]);
  assert.equal(moved, "🟪⬛🟨🟪⬛");
});

/* ---------- race standings ---------- */
const P = (uid, n, solved, tms, out) => ({ uid, n, solved: !!solved, tms: tms == null ? null : tms, out: !!out });
test("race ranking: solved first by fewest guesses, then by solve time", () => {
  const r = M.rankRace([P("slow3", 3, true, 50000), P("fast3", 3, true, 20000), P("two", 2, true, 90000), P("six", 6, true, 10000)]);
  assert.deepEqual(r.map((x) => x.uid), ["two", "fast3", "slow3", "six"]);
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 3, 4]);
});
test("race ranking: solved, then out of guesses, then still playing", () => {
  const r = M.rankRace([P("playing", 2, false, null, false), P("out", 6, false, null, true), P("solved", 5, true, 99000), P("timeout", 3, false, null, true)]);
  assert.deepEqual(r.map((x) => x.uid), ["solved", "out", "timeout", "playing"]);
  assert.deepEqual(r.map((x) => x.status), ["solved", "out", "out", "playing"]);
  assert.equal(M.raceDone(r), false);
  assert.equal(M.raceDone(r.filter((x) => x.uid !== "playing")), true);
  assert.equal(M.raceDone([]), false);
});
test("race ranking: a tie on guesses and time shares a rank, and the next rank skips", () => {
  const r = M.rankRace([P("b", 3, true, 40000), P("a", 3, true, 40000), P("c", 3, true, 41000), P("d", 2, true, 99000)], (u) => u);
  assert.deepEqual(r.map((x) => x.uid), ["d", "a", "b", "c"]);
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 2, 4]);
  assert.deepEqual(r.map((x) => x.tied), [false, true, true, false]);
  const outs = M.rankRace([P("x", 6, false, null, true), P("y", 6, false, null, true)], (u) => u);
  assert.deepEqual(outs.map((x) => x.rank), [1, 1]);
});
test("race ranking: input is not changed, and lines read well", () => {
  const input = [P("b", 4, true, 65000), P("a", 2, true, 12000)];
  const before = JSON.stringify(input);
  const r = M.rankRace(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(M.resultLine(r[0]), "1st · solved in 2 · 0:12");
  assert.equal(M.resultLine(r[1]), "2nd · solved in 4 · 1:05");
  assert.equal(M.resultLine({ status: "out", n: 6 }), "Out after 6 guesses");
  assert.equal(M.resultLine({ status: "playing", n: 1 }), "Still playing · 1 guess");
  assert.equal(M.ordinal(11), "11th"); assert.equal(M.ordinal(22), "22nd"); assert.equal(M.ordinal(3), "3rd");
});

/* ---------- key hashes ---------- */
test("key hash: the page's SHA-256 matches Node's, so the word server accepts it", () => {
  const crypto = require("node:crypto");
  for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "0123456789abcdef".repeat(2), "x".repeat(200)]) {
    assert.equal(M.sha256Hex(text), crypto.createHash("sha256").update(text).digest("hex"), JSON.stringify(text.slice(0, 20)));
  }
  const k = M.randomHex(16);
  assert.match(k, /^[a-f0-9]{32}$/);
  assert.notEqual(k, M.randomHex(16));
  assert.match(M.sha256Hex(k), /^[a-f0-9]{64}$/);
});
