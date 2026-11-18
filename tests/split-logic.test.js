/* Split Decision scoring and leaderboard. Run: node --test split-logic.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../play/poster-logic.js");

function p(id, answer, prediction, extra){ return Object.assign({ id, answer, prediction }, extra); }
function row(result, id){ return result.rows.find((r) => r.id === id); }

test("all choose A: everyone's target is N-1", () => {
  const r = L.scoreRound([p("a", "A", 3), p("b", "A", 2), p("c", "A", 1), p("d", "A", 0)]);
  assert.equal(r.n, 4);
  assert.equal(r.aCount, 4);
  assert.equal(r.pctA, 100);
  assert.deepEqual(r.rows.map((x) => x.target), [3, 3, 3, 3]);
  assert.deepEqual(r.rows.map((x) => x.result), ["exact", "one-away", "miss", "miss"]);
  assert.deepEqual(r.rows.map((x) => x.points), [2, 1, 0, 0]);
});

test("all choose B: everyone's target is 0", () => {
  const r = L.scoreRound([p("a", "B", 0), p("b", "B", 1), p("c", "B", 2)]);
  assert.equal(r.aCount, 0);
  assert.equal(r.bCount, 3);
  assert.equal(r.pctA, 0);
  assert.deepEqual(r.rows.map((x) => [x.target, x.result, x.points]), [[0, "exact", 2], [0, "one-away", 1], [0, "miss", 0]]);
});

test("an even split of 6: A pickers see 2 other A, B pickers see 3", () => {
  const r = L.scoreRound([p("a", "A", 2), p("b", "A", 3), p("c", "A", 0), p("d", "B", 3), p("e", "B", 2), p("f", "B", 5)]);
  assert.equal(r.aCount, 3);
  assert.equal(r.pctA, 50);
  assert.deepEqual(r.rows.map((x) => x.target), [2, 2, 2, 3, 3, 3]);
  assert.deepEqual(r.rows.map((x) => x.result), ["exact", "one-away", "miss", "exact", "one-away", "miss"]);
});

test("odd player counts: 3 and 7 players", () => {
  const three = L.scoreRound([p("a", "A", 1), p("b", "A", 1), p("c", "B", 2)]);
  assert.deepEqual(three.rows.map((x) => [x.target, x.points]), [[1, 2], [1, 2], [2, 2]]);
  const seven = L.scoreRound([p("a", "A", 4), p("b", "A", 3), p("c", "A", 2), p("d", "A", 6), p("e", "B", 4), p("f", "B", 5), p("g", "B", 0)]);
  assert.equal(seven.n, 7);
  assert.equal(seven.aCount, 4);
  assert.deepEqual(seven.rows.map((x) => x.target), [3, 3, 3, 3, 4, 4, 4]);
  assert.deepEqual(seven.rows.map((x) => x.points), [1, 2, 1, 0, 2, 1, 0]);
});

test("exact is +2, one away is +1 either side, two or more away is 0", () => {
  const base = [p("b", "A", 0), p("c", "B", 0), p("d", "B", 0), p("e", "B", 0)];
  const at = (n) => row(L.scoreRound([p("me", "B", n)].concat(base)), "me");
  assert.equal(at(1).result, "exact");
  assert.equal(at(1).points, 2);
  assert.equal(at(0).result, "one-away");
  assert.equal(at(2).result, "one-away");
  assert.equal(at(2).points, 1);
  assert.equal(at(3).result, "miss");
  assert.equal(at(3).error, 2);
  assert.equal(at(3).points, 0);
  assert.equal(at(4).points, 0);
});

test("own answer is excluded: 5 players, 4 choose A, an A picker who says 3 is EXACT", () => {
  const r = L.scoreRound([p("me", "A", 3), p("b", "A", 0), p("c", "A", 0), p("d", "A", 0), p("e", "B", 4)]);
  const me = row(r, "me");
  assert.equal(me.target, 3);
  assert.equal(me.result, "exact");
  assert.equal(me.points, 2);
  // The B picker sees all four A pickers.
  assert.equal(row(r, "e").target, 4);
  assert.equal(row(r, "e").result, "exact");
});

test("a player who answered and then disconnected keeps the answer and is scored", () => {
  const r = L.scoreRound([p("a", "A", 1, { connected: false }), p("b", "A", 1), p("c", "B", 2)]);
  assert.equal(r.aCount, 2);
  assert.equal(row(r, "a").result, "exact");
  assert.equal(row(r, "a").points, 2);
  assert.equal(row(r, "c").target, 2);
});

test("a player who never answered gets 0, is marked missed, and is not counted as A or B", () => {
  const r = L.scoreRound([p("a", "A", 1), p("b", "A", 1), p("c", null, null), p("d", "B", 2)]);
  assert.equal(r.n, 4);
  assert.equal(r.aCount, 2);
  assert.equal(r.answered, 3);
  assert.equal(row(r, "c").result, "missed");
  assert.equal(row(r, "c").points, 0);
  assert.equal(row(r, "a").target, 1);
  assert.equal(row(r, "a").result, "exact");
});

test("an answer with no guess, or a guess out of range, is a MISS for 0, and the answer still counts", () => {
  const r = L.scoreRound([p("a", "A", null), p("b", "A", 9), p("c", "B", 2), p("d", "B", 1.5)]);
  assert.equal(r.aCount, 2);
  assert.deepEqual(r.rows.map((x) => [x.result, x.points]), [["miss", 0], ["miss", 0], ["exact", 2], ["miss", 0]]);
});

test("a duplicate submission is ignored and the first one wins", () => {
  const r = L.scoreRound([p("a", "A", 1), p("b", "B", 1), p("a", "B", 0), p("c", "B", 1)]);
  assert.equal(r.n, 3);
  assert.equal(r.aCount, 1);
  assert.equal(r.rows.length, 3);
  assert.equal(row(r, "a").answer, "A");
  assert.equal(row(r, "a").prediction, 1);
  // a picked A and said 1, but nobody else picked A: one away, scored on the first answer only.
  assert.equal(row(r, "a").target, 0);
  assert.equal(row(r, "a").result, "one-away");
  assert.equal(row(r, "b").result, "exact");
});

test("scoreRound is pure: same input, same output, input untouched", () => {
  const input = [p("a", "A", 1), p("b", "B", 1)];
  const copy = JSON.parse(JSON.stringify(input));
  assert.deepEqual(L.scoreRound(input), L.scoreRound(input));
  assert.deepEqual(input, copy);
});

test("stored rows round-trip and stay under the 128-character rule limit", () => {
  const scored = L.scoreRound([p("a", "A", 1), p("b", "A", 1), p("c", null, null)]);
  const stats = L.nextStats({}, scored);
  scored.rows.forEach((r) => {
    const raw = L.encodeResult(12, 7, r, stats[r.id]);
    assert.ok(raw.length <= 128);
    const back = L.decodeResult(raw);
    assert.equal(back.gameId, 12);
    assert.equal(back.round, 7);
    assert.equal(back.result, r.result);
    assert.equal(back.points, r.points);
    assert.equal(back.answer, r.answer);
    assert.equal(back.prediction, r.prediction);
    assert.equal(back.total, stats[r.id].total);
  });
  assert.equal(L.decodeResult("A|3"), null);
  assert.equal(L.decodeResult(""), null);
});

test("running stats: totals, exact count, accuracy inputs and streaks", () => {
  let stats = {};
  stats = L.nextStats(stats, L.scoreRound([p("a", "A", 1), p("b", "A", 0), p("c", "B", 0)]));
  assert.deepEqual(stats.a, { total: 2, exact: 1, hits: 1, played: 1, streak: 1, best: 1, minority: 0, bold: 0 });
  assert.deepEqual(stats.c, { total: 0, exact: 0, hits: 0, played: 1, streak: 0, best: 0, minority: 1, bold: 0 });
  stats = L.nextStats(stats, L.scoreRound([p("a", "A", 0), p("b", "A", 1), p("c", null, null)]));
  assert.deepEqual(stats.a, { total: 3, exact: 1, hits: 2, played: 2, streak: 2, best: 2, minority: 0, bold: 0 });
  assert.deepEqual(stats.b, { total: 3, exact: 1, hits: 2, played: 2, streak: 2, best: 2, minority: 0, bold: 0 });
  assert.deepEqual(stats.c, { total: 0, exact: 0, hits: 0, played: 2, streak: 0, best: 0, minority: 1, bold: 0 });
});

test("leaderboard ties share a rank, zero-point players are listed, leader and biggest mover", () => {
  const board = L.rankBoard([
    { id: "a", name: "Ada", total: 4, points: 0, exact: 2, hits: 2, played: 3, streak: 0 },
    { id: "b", name: "Bea", total: 4, points: 2, exact: 1, hits: 2, played: 3, streak: 2 },
    { id: "c", name: "Cal", total: 0, points: 0, exact: 0, hits: 0, played: 3, streak: 0 },
    { id: "d", name: "Dev", total: 3, points: 2, exact: 1, hits: 1, played: 3, streak: 1 }
  ], false);
  assert.deepEqual(board.map((e) => [e.id, e.rank]), [["a", 1], ["b", 1], ["d", 3], ["c", 4]]);
  assert.deepEqual(board.filter((e) => e.leader).map((e) => e.id), ["a", "b"]);
  const c = board.find((e) => e.id === "c");
  assert.equal(c.total, 0);
  assert.equal(c.accuracy, 0);
  // Before: Ada 4, Bea 2, Dev 1, Cal 0. Bea climbs from 2nd to a shared 1st; Dev stays 3rd.
  assert.equal(board.find((e) => e.id === "b").moved, 1);
  assert.equal(board.find((e) => e.id === "d").moved, 0);
  assert.deepEqual(board.filter((e) => e.mover).map((e) => e.id), ["b"]);
  assert.equal(board.find((e) => e.id === "a").accuracy, 67);
});

test("no leader when everyone has 0, and no biggest mover on the first round", () => {
  const board = L.rankBoard([
    { id: "a", name: "Ada", total: 0, points: 0, exact: 0, hits: 0, played: 1, streak: 0 },
    { id: "b", name: "Bea", total: 0, points: 0, exact: 0, hits: 0, played: 1, streak: 0 }
  ], true);
  assert.deepEqual(board.map((e) => e.rank), [1, 1]);
  assert.equal(board.some((e) => e.leader), false);
  assert.equal(board.some((e) => e.mover), false);
});

test("quips come from the fixed list for each result type", () => {
  for (const kind of ["exact", "one-away", "miss", "missed"]) {
    const line = L.quipFor(kind, "1/0/u1");
    assert.ok(L.QUIPS[kind].includes(line), kind);
    assert.equal(L.quipFor(kind, "1/0/u1"), line);
  }
});

test("media mode: still on reduced motion, Save-Data and 2g/3g, video otherwise", () => {
  assert.equal(L.mediaMode({}), "video");
  assert.equal(L.mediaMode({ connection: { effectiveType: "4g" } }), "video");
  assert.equal(L.mediaMode({ reducedMotion: true }), "still");
  assert.equal(L.mediaMode({ connection: { saveData: true, effectiveType: "4g" } }), "still");
  assert.equal(L.mediaMode({ connection: { effectiveType: "3g" } }), "still");
  assert.equal(L.mediaMode({ connection: { effectiveType: "2g" } }), "still");
  assert.equal(L.mediaMode({ connection: { effectiveType: "slow-2g" } }), "still");
});

/* ---- Phase 2 ---- */

test("confidence stakes: 1x is the Phase 1 score, 2x and 3x multiply hits and charge for a miss", () => {
  const base = [p("b", "A", 0), p("c", "B", 0), p("d", "B", 0)];
  const at = (n, stake) => row(L.scoreRound([Object.assign(p("me", "B", n), { stake })].concat(base)), "me");
  // target for a B picker = 1
  assert.deepEqual([at(1, 1).points, at(0, 1).points, at(3, 1).points], [2, 1, 0]);
  assert.deepEqual([at(1, 2).points, at(0, 2).points, at(3, 2).points], [4, 2, -1]);
  assert.deepEqual([at(1, 3).points, at(2, 3).points, at(3, 3).points], [6, 3, -2]);
  assert.equal(at(1, 3).base, 2);
  assert.equal(at(3, 3).base, 0);
  // A bad stake value is 1x.
  assert.equal(at(1, 7).points, 2);
  assert.equal(at(1, 7).stake, 1);
});

test("a stake never costs a player who did not answer, or who answered with no guess", () => {
  const r = L.scoreRound([Object.assign(p("a", null, null), { stake: 3 }), Object.assign(p("b", "A", null), { stake: 3 }), p("c", "B", 0)]);
  assert.equal(row(r, "a").points, 0);
  assert.equal(row(r, "a").result, "missed");
  assert.equal(row(r, "b").points, 0);
  assert.equal(row(r, "b").result, "miss");
});

test("minority side: fewer pickers is the minority, an even split or a clean sweep has none", () => {
  const r = L.scoreRound([p("a", "A", 0), p("b", "B", 1), p("c", "B", 1)]);
  assert.equal(r.minority, "A");
  assert.deepEqual(r.rows.map((x) => x.minority), [true, false, false]);
  assert.equal(L.scoreRound([p("a", "A", 0), p("b", "B", 0)]).minority, null);
  assert.equal(L.scoreRound([p("a", "B", 0), p("b", "B", 0)]).minority, null);
});

test("running stats keep the best streak, minority picks and points won on stakes", () => {
  let s = {};
  const rounds = [
    [Object.assign(p("a", "A", 0), { stake: 3 }), p("b", "B", 1), p("c", "B", 1)], // a exact 3x = 6, minority
    [Object.assign(p("a", "A", 2), { stake: 2 }), p("b", "A", 2), p("c", "A", 2)], // a exact 2x = 4
    [Object.assign(p("a", "A", 2), { stake: 2 }), p("b", "B", 1), p("c", "B", 1)]  // a miss 2x = -1, minority
  ];
  rounds.forEach((r) => { s = L.nextStats(s, L.scoreRound(r)); });
  assert.deepEqual(s.a, { total: 9, exact: 2, hits: 2, played: 3, streak: 0, best: 2, minority: 2, bold: 10 });
});

test("v3 rows round-trip with stake and award fields, and Phase 1 v2 rows still decode", () => {
  const r = L.scoreRound([Object.assign(p("a", "A", 0), { stake: 3 }), p("b", "B", 1), p("c", "B", 3)]);
  const st = L.nextStats({}, r);
  const raw = L.encodeResult(4, 9, row(r, "a"), st.a);
  assert.ok(raw.length <= 128);
  const d = L.decodeResult(raw);
  assert.deepEqual([d.round, d.stake, d.result, d.points, d.total, d.best, d.minority, d.bold], [9, 3, "exact", 6, 6, 1, 1, 6]);
  const neg = L.decodeResult(L.encodeResult(4, 9, Object.assign({}, row(r, "c"), { stake: 3, points: -2 }), { total: -2 }));
  assert.equal(neg.points, -2);
  assert.equal(neg.total, -2);
  const old = L.decodeResult("v2|1|3|A|2|E|2|7|2|3|4|1");
  assert.deepEqual([old.round, old.stake, old.result, old.total, old.streak, old.best, old.minority, old.bold], [3, 1, "exact", 7, 1, 1, 0, 0]);
});

test("after round 8: a single leader ends the game, a tie at the top goes to sudden death, capped", () => {
  const e = (id, total) => ({ id, total });
  assert.deepEqual(L.afterRound(3, [e("a", 5), e("b", 5)], 0), { next: "round" });
  assert.deepEqual(L.afterRound(7, [e("a", 6), e("b", 5), e("c", 5)], 0), { next: "over", shared: false });
  assert.deepEqual(L.afterRound(7, [e("a", 6), e("b", 6), e("c", 2)], 0), { next: "sudden", ids: ["a", "b"] });
  assert.deepEqual(L.afterRound(9, [e("a", 8), e("b", 8)], 2), { next: "sudden", ids: ["a", "b"] });
  assert.deepEqual(L.afterRound(10, [e("a", 8), e("b", 8)], 3), { next: "over", shared: true });
  assert.deepEqual(L.afterRound(8, [e("a", 9), e("b", 8)], 1), { next: "over", shared: false });
  assert.deepEqual(L.tiedLeaders([e("a", -1), e("b", -1)]), ["a", "b"]);
  assert.deepEqual(L.tiedLeaders([]), []);
});

test("end-of-game awards: the best value wins, ties share, nobody at 0 gets one", () => {
  const awards = L.gameAwards([
    { id: "a", exact: 3, hits: 4, minority: 1, best: 3, bold: 0 },
    { id: "b", exact: 3, hits: 3, minority: 4, best: 2, bold: 6 },
    { id: "c", exact: 0, hits: 2, minority: 0, best: 1, bold: 0 }
  ]);
  const by = Object.fromEntries(awards.map((a) => [a.key, a]));
  assert.deepEqual(by.reader.ids, ["a", "b"]);
  assert.equal(by.reader.line, "3 exact guesses");
  assert.deepEqual(by.contrarian.ids, ["b"]);
  assert.deepEqual(by.streak.ids, ["a"]);
  assert.deepEqual(by.near.ids, ["c"]);
  assert.equal(by.near.value, 2);
  assert.deepEqual(by.roller.ids, ["b"]);
  assert.equal(L.gameAwards([{ id: "a", exact: 0, hits: 0, minority: 0, best: 0, bold: 0 }]).length, 0);
});
