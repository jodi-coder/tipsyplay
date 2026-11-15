/* Mole rules. Run: node --test mole-logic.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../play/mole-logic.js");
function seq(values){ let i = 0; return () => values[i++ % values.length]; }

test("names and rounds validate like the other games", () => {
  assert.equal(L.nameError("", []), "Add your name first.");
  assert.equal(L.nameError("Ada", ["ada"]), "Someone already has that name. Try another.");
  assert.equal(L.nameError("Ada", []), "");
  assert.equal(L.clampRounds(1), 3);
  assert.equal(L.clampRounds(99), 15);
  assert.equal(L.clampRounds(7), 7);
});

test("every round names a valid word and a mole from the table", () => {
  const uids = ["A", "B", "C", "D", "E"];
  const rounds = L.makeRounds(uids, 10, 20, { u32: seq([3, 1, 4, 1, 5, 9, 2, 6]) });
  rounds.forEach((r) => {
    assert.ok(uids.includes(r.mole));
    assert.ok(r.word >= 0 && r.word < 20);
  });
});

test("the mole role is spread evenly across players", () => {
  const uids = ["A", "B", "C", "D"];
  const g = L.newGame(uids.map((u) => ({ uid: u, name: u })), "sips", 12, 20, { u32: seq([2, 7, 1, 5, 3]) });
  const c = L.moleCounts(g);
  const vals = Object.values(c);
  assert.ok(Math.max(...vals) - Math.min(...vals) <= 1, JSON.stringify(c));
});

test("tally: a clear majority targets one player; a tie or a plurality does not", () => {
  const active = ["A", "B", "C", "D", "E"];
  assert.equal(L.tally({ A: "C", B: "C", D: "C" }, active).target, "C");       // 3 of 5 > half
  assert.equal(L.tally({ A: "C", B: "C", D: "E" }, active).target, null);       // 2 is not a majority of 5
  assert.equal(L.tally({ A: "C", B: "C", D: "E", E: "E" }, active).target, null); // tie at the top
  assert.equal(L.tally({ A: "B" }, active).target, null);
});

test("voteOutcome: the group catches the mole only on a majority for the mole", () => {
  const g = L.newGame(["A", "B", "C", "D"].map((u) => ({ uid: u, name: u })), "sips", 3, 10, { u32: seq([1]) });
  const mole = L.current(g).mole;
  const others = g.order.filter((u) => u !== mole);
  // everyone but the mole votes for the mole
  const ballots = {}; others.forEach((u) => (ballots[u] = mole));
  assert.equal(L.voteOutcome(g, ballots).caught, true);
  // everyone votes for one non-mole instead
  const scape = others[0], b2 = {};
  g.order.forEach((u) => { if (u !== scape) b2[u] = scape; });
  assert.equal(L.voteOutcome(g, b2).caught, false);
});

test("scoring and drinks: caught-and-fails, caught-and-steals, and survives", () => {
  function fresh(){ return L.newGame(["A", "B", "C", "D"].map((u) => ({ uid: u, name: u })), "sips", 3, 10, { u32: seq([1, 2, 3]) }); }
  // caught, no steal -> each non-mole +1, the mole drinks
  let g = fresh(); let m = L.current(g).mole; let grp = g.order.filter((u) => u !== m);
  let e = L.finishRound(g, { caught: true, accused: m, stole: false });
  grp.forEach((u) => assert.equal(g.score[u], 1));
  assert.deepEqual(e.banner.drinkers, [m]);
  // caught but steals -> mole +1, the group drinks
  g = fresh(); m = L.current(g).mole; grp = g.order.filter((u) => u !== m);
  e = L.finishRound(g, { caught: true, accused: m, stole: true });
  assert.equal(g.score[m], 1);
  assert.deepEqual(e.banner.drinkers.sort(), grp.slice().sort());
  // survives -> mole +2, the group drinks
  g = fresh(); m = L.current(g).mole; grp = g.order.filter((u) => u !== m);
  e = L.finishRound(g, { caught: false, accused: grp[0], stole: false });
  assert.equal(g.score[m], 2);
  assert.deepEqual(e.banner.drinkers.sort(), grp.slice().sort());
});

test("no-drinking setting turns the round drink into the alternative", () => {
  const g = L.newGame(["A", "B", "C", "D"].map((u) => ({ uid: u, name: u })), "none", 3, 10, { u32: seq([1]) });
  const m = L.current(g).mole;
  const e = L.finishRound(g, { caught: true, accused: m, stole: false });
  assert.deepEqual(e.banner.drinkers, []);
  assert.equal(e.banner.noDrinking, true);
});

test("a full game advances through every round and names a winner", () => {
  const g = L.newGame(["A", "B", "C", "D"].map((u) => ({ uid: u, name: u })), "sips", 4, 10, { u32: seq([5, 2, 8, 1]) });
  for (let r = 0; r < 4; r++){
    const m = L.current(g).mole;
    L.finishRound(g, { caught: false, accused: g.order.find((u) => u !== m), stole: false });
  }
  assert.equal(g.round, 4);
  assert.ok(g.winner);
  const fin = L.finish(g);
  assert.equal(fin.rounds, 4);
  assert.equal(fin.standings.length, 4);
});

test("newGame rejects fewer than 4 or more than 10 players", () => {
  assert.throws(() => L.newGame(["A", "B", "C"].map((u) => ({ uid: u, name: u })), "sips", 3, 10));
  const many = Array.from({ length: 11 }, (_, i) => ({ uid: "U" + i, name: "U" + i }));
  assert.throws(() => L.newGame(many, "sips", 3, 10));
});
