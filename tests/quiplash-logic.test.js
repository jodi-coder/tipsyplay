/* Quiplash rules. Run: node --test quiplash-logic.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../play/quiplash-logic.js");

// a deterministic 32-bit source so matchups are reproducible in tests
function seq(values){ let i = 0; return () => values[i++ % values.length]; }

test("names: non-empty, trimmed, capped, unique ignoring case", () => {
  assert.equal(L.nameError("", []), "Add your name first.");
  assert.equal(L.nameError("   ", []), "Add your name first.");
  assert.equal(L.nameError("Ada", ["ADA"]), "Someone already has that name. Try another.");
  assert.equal(L.nameError("abcdefghijklmnop", []), "Names can be up to 12 characters.");
  assert.equal(L.nameError("Ada", ["Bo"]), "");
  assert.equal(L.cleanName("  a <b> c  "), "a b c");
});

test("answers: stripped of angle brackets, trimmed, capped at 80, non-empty", () => {
  assert.equal(L.answerError(""), "Type an answer first.");
  assert.equal(L.answerError("  "), "Type an answer first.");
  assert.equal(L.answerError("a joke"), "");
  assert.equal(L.cleanAnswer("  a <script> joke  "), "a script joke");
  assert.equal(L.cleanAnswer("x".repeat(200)).length, 80);
});

test("rounds clamp to 3..20", () => {
  assert.equal(L.clampRounds(0), 3);
  assert.equal(L.clampRounds(2), 3);
  assert.equal(L.clampRounds(5), 5);
  assert.equal(L.clampRounds(99), 20);
});

test("matchups: the two authors are always different people", () => {
  for (let n = 3; n <= 12; n++) {
    const uids = Array.from({ length: n }, (_, i) => "U" + i);
    const ms = L.makeMatchups(uids, 20, 30, { u32: seq([3, 7, 11, 2, 5, 9, 13, 1, 8, 4, 6, 10]) });
    ms.forEach((m) => {
      assert.notEqual(m.a, m.b, `n=${n}`);
      assert.ok(uids.includes(m.a) && uids.includes(m.b));
      assert.ok(m.prompt >= 0 && m.prompt < 30);
    });
  }
});

test("matchups: answer counts stay even (max 2 apart over many rounds)", () => {
  const uids = Array.from({ length: 5 }, (_, i) => "U" + i);
  const g = L.newGame(uids.map((u) => ({ uid: u, name: u })), "sips", 15, 20, { u32: seq([1, 2, 3, 4, 5, 6, 7]) });
  const c = L.answerCounts(g);
  const vals = Object.values(c);
  assert.ok(Math.max(...vals) - Math.min(...vals) <= 2, JSON.stringify(c));
});

test("tally: only non-authors count, majority wins, equal is a tie", () => {
  const m = { a: "A", b: "B", prompt: 0 };
  assert.deepEqual(L.tallyVotes({ C: "a", D: "a", E: "b" }, m), { a: 2, b: 1, winner: "a", tie: false });
  // the authors' own ballots are ignored
  assert.deepEqual(L.tallyVotes({ A: "a", B: "b", C: "b" }, m), { a: 0, b: 1, winner: "b", tie: false });
  assert.deepEqual(L.tallyVotes({ C: "a", D: "b" }, m), { a: 1, b: 1, winner: null, tie: true });
  assert.deepEqual(L.voters(["A", "B", "C", "D"], m), ["C", "D"]);
});

test("drinks: the losing author drinks; a tie is nobody; none makes it the alternative", () => {
  const m = { a: "A", b: "B", prompt: 0 };
  assert.deepEqual(L.roundDrinks(m, { winner: "a", tie: false }, "sips").drinkers, ["B"]);
  assert.deepEqual(L.roundDrinks(m, { winner: "b", tie: false }, "sips").drinkers, ["A"]);
  assert.equal(L.roundDrinks(m, { winner: null, tie: true }, "sips"), null);
  const none = L.roundDrinks(m, { winner: "a", tie: false }, "none");
  assert.deepEqual(none.drinkers, []);
  assert.equal(none.noDrinking, true);
  assert.equal(L.roundDrinks(m, { winner: "a", tie: false }, "shots").amount, "one shot");
});

test("a full three-player game: scores accrue and a winner is named", () => {
  const players = ["A", "B", "C"].map((u) => ({ uid: u, name: u }));
  const g = L.newGame(players, "sips", 3, 10, { u32: seq([2, 4, 1, 3, 5]) });
  assert.equal(g.matchups.length, 3);
  for (let r = 0; r < 3; r++) {
    const m = L.current(g);
    const answers = { [m.a]: "answer A", [m.b]: "answer B" };
    // the single non-author always votes for a, so a's authors pile up wins
    const voter = L.voters(g.order, m)[0];
    const entry = L.resolveRound(g, answers, { [voter]: "a" });
    assert.equal(entry.winner, m.a);
    assert.equal(entry.tie, false);
  }
  assert.equal(g.round, 3);
  assert.ok(g.winner);
  const fin = L.finish(g);
  assert.equal(fin.rounds, 3);
  assert.ok(fin.winner.uids.length >= 1);
  assert.equal(fin.standings.length, 3);
  assert.ok(fin.standings[0].score >= fin.standings[2].score);
});

test("newGame rejects out-of-range player counts", () => {
  assert.throws(() => L.newGame([{ uid: "A", name: "A" }, { uid: "B", name: "B" }], "sips", 3, 10));
  const many = Array.from({ length: 13 }, (_, i) => ({ uid: "U" + i, name: "U" + i }));
  assert.throws(() => L.newGame(many, "sips", 3, 10));
});
