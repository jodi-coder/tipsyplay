/* Category Countdown rules. Run: node --test countdown-logic.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../play/countdown-logic.js");
const DATA = require("../data/countdown.js");

const first = () => 0;
const P = (n) => Array.from({ length: n }, (_, i) => ({ uid: "u" + i, name: "P" + i }));
function spot(n, opts) { const G = L.newGame(P(n || 3), Object.assign({ mode: "spot" }, opts)); L.startRound(G, DATA, 0, first); L.tick(G, DATA, G.deadline, first); return G; }
function potato(n, opts) { const G = L.newGame(P(n || 3), Object.assign({ mode: "potato" }, opts)); L.startRound(G, DATA, 0, first); L.tick(G, DATA, G.deadline, first); return G; }

/* ---------- content ---------- */
test("content: 200+ categories with a pack, a difficulty and a target; no repeats or banned wording", () => {
  assert.ok(DATA.list.length >= 200);
  for (const p of ["mild", "spicy", "extra"]) assert.ok(DATA.list.filter((c) => c.pack === p).length >= 50, p);
  for (const d of ["easy", "medium", "hard"]) assert.ok(DATA.list.some((c) => c.d === d), d);
  DATA.list.forEach((c) => {
    assert.ok(c.target >= 3 && c.target <= 8, c.text);
    assert.ok(!/\bsips?\b|water/i.test(c.text), c.text);
  });
  assert.equal(new Set(DATA.list.map((c) => c.text.toLowerCase())).size, DATA.list.length);
  DATA.alts.forEach((a) => assert.ok(!/\bsips?\b|water/i.test(a)));
});
test("categories follow the chosen pack and difficulty, with no repeats until the pool runs out", () => {
  const G = L.newGame(P(3), { pack: "extra", diff: "easy" });
  const seen = new Set();
  const pool = DATA.list.filter((c) => c.pack === "extra" && c.d === "easy").length;
  for (let i = 0; i < pool; i++) { const c = L.pickCategory(G, DATA); assert.equal(c.d, "easy"); seen.add(c.text); }
  assert.equal(seen.size, pool);
});

/* ---------- answer matching ---------- */
test("matching: case, spacing, punctuation, accents, articles and plurals don't matter", () => {
  assert.ok(L.same("Ice Cream", "icecream"));
  assert.ok(L.same("  the  Strawberries!", "strawberry"));
  assert.ok(L.same("boxes", "Box"));
  assert.ok(L.same("Crème brûlée", "creme brulee"));
  assert.ok(L.same("an apple", "Apples"));
  assert.ok(L.same("salt & pepper", "salt and pepper"));
  assert.ok(L.same("lettuce", "letuce"), "one slip on a 6+ letter answer");
  assert.ok(!L.same("cat", "car"), "short answers must match exactly");
  assert.ok(!L.same("glass", "grass"));
  assert.ok(!L.same("milk", "mild"));
  assert.ok(!L.same("bus", "bu"), "-us words keep their s");
  assert.ok(!L.same("grade a", "grade b"), "multi-word answers need an exact match");
  assert.equal(L.singular("dresses"), "dress");
  assert.equal(L.key("The Big Cats"), "big cat");
});

/* ---------- Spotlight ---------- */
test("spotlight: phases run intro -> answer -> result with no challenges, and the actor rotates", () => {
  const G = L.newGame(P(3), { mode: "spot" });
  L.startRound(G, DATA, 0, first);
  assert.equal(G.phase, "intro"); assert.equal(G.actor, "u0");
  L.tick(G, DATA, L.T.intro, first); assert.equal(G.phase, "answer"); assert.equal(G.deadline, L.T.intro + L.T.answer);
  L.tick(G, DATA, G.deadline, first); assert.equal(G.phase, "result");
  L.tick(G, DATA, G.deadline, first); assert.equal(G.phase, "intro"); assert.equal(G.actor, "u1");
});
test("spotlight: only the actor answers; duplicates and near-duplicates are dropped", () => {
  const G = spot(3);
  assert.ok(L.addAnswer(G, "u0", "Milk", 10).ok);
  assert.equal(L.addAnswer(G, "u1", "Eggs", 11).error, "Not your turn.");
  assert.ok(L.addAnswer(G, "u0", "milks", 12).dup);
  assert.ok(L.addAnswer(G, "u0", " MILK ", 13).dup);
  assert.ok(L.addAnswer(G, "u0", "Eggs", 14).ok);
  assert.equal(L.addAnswer(G, "u0", "   ", 15).error, "Type an answer.");
  assert.equal(G.answers.length, 2);
});
test("spotlight hit: 1 point per answer plus 1 for the target; everyone else drinks", () => {
  const G = spot(3);
  const target = G.cat.target;
  for (let i = 0; i < target; i++) L.addAnswer(G, "u0", "answer number " + "abcdefghij"[i], 10 + i);
  L.tick(G, DATA, G.deadline, first);
  assert.equal(G.outcome.hit, true);
  assert.equal(G.scores.u0, target + 1);
  assert.deepEqual(G.drinks.map((d) => d.uid + ":" + d.what), ["u1:drink", "u2:drink"]);
});
test("spotlight miss: points for answers, no bonus; the actor drinks", () => {
  const G = spot(3);
  L.addAnswer(G, "u0", "one", 10);
  L.tick(G, DATA, G.deadline, first);
  assert.equal(G.outcome.hit, false);
  assert.equal(G.scores.u0, 1);
  assert.deepEqual(G.drinks.map((d) => d.uid + ":" + d.what), ["u0:drink"]);
  assert.equal(G.stats.u0.freezes, 1);
});
test("spotlight challenges: others tap to challenge (and can take it back); a vote with more downs removes it; ties keep", () => {
  const G = spot(4);
  L.addAnswer(G, "u0", "Milk", 10); L.addAnswer(G, "u0", "Socks", 11); L.addAnswer(G, "u0", "Butter", 12);
  assert.equal(L.challenge(G, "u0", "a1"), false, "the actor can't challenge");
  assert.ok(L.challenge(G, "u1", "a1")); assert.equal(L.challenge(G, "u1", "a1"), false);
  assert.ok(L.challenge(G, "u2", "a2")); assert.ok(L.challenge(G, "u2", "a2", false)); // taken back
  assert.ok(L.challenge(G, "u3", "a0"));
  L.tick(G, DATA, G.deadline, first);
  assert.equal(G.phase, "cvote");
  assert.deepEqual(G.voteIds.sort(), ["a0", "a1"]);
  assert.equal(L.castVote(G, "u0", "a1", "d"), false, "the actor doesn't vote");
  L.castVote(G, "u1", "a1", "d"); L.castVote(G, "u2", "a1", "d"); L.castVote(G, "u3", "a1", "u");
  L.castVote(G, "u1", "a0", "d"); L.castVote(G, "u2", "a0", "u");
  assert.equal(L.castVote(G, "u1", "a0", "u"), false, "one vote each");
  assert.equal(L.tick(G, DATA, G.deadline - 1, first), "", "waits for u3 on a0");
  L.castVote(G, "u3", "a0", "x");
  L.tick(G, DATA, G.deadline - 1, first, { u3: true });
  assert.equal(G.phase, "result");
  assert.equal(G.answers[1].status, "out");  // socks: 2 down, 1 up
  assert.equal(G.answers[0].status, "ok");   // milk: 1-1 tie keeps it
  assert.equal(G.outcome.count, 2);
  assert.equal(G.stats.u0.challenged, 2);
});
test("challenge votes stay hidden until the vote closes", () => {
  const G = spot(3);
  L.addAnswer(G, "u0", "Milk", 10); L.challenge(G, "u1", "a0");
  L.tick(G, DATA, G.deadline, first);
  L.castVote(G, "u1", "a0", "d");
  let v = L.publicView(G);
  assert.equal(v.votesIn, 1); assert.equal(v.answers[0].down, undefined);
  L.castVote(G, "u2", "a0", "d"); L.tick(G, DATA, 1e9, first);
  v = L.publicView(G);
  assert.equal(v.answers[0].down, 2);
});

/* ---------- drinks ---------- */
test("drink cap: one drink per player per round, then the alternative; points only is always the alternative; choices never block", () => {
  const G = potato(4);
  assert.equal(L.drinkOrAlt(G, "u1"), "drink"); assert.equal(L.drinkOrAlt(G, "u1"), "alt");
  const N = spot(3, { na: true }); L.tick(N, DATA, N.deadline, first);
  assert.deepEqual(N.drinks.map((d) => d.what), ["alt"]);
  assert.ok(L.choose(N, "u0", "pass")); assert.equal(L.choose(N, "u0", "drink"), false); assert.equal(L.choose(N, "u1", "drink"), false, "u1 owes nothing");
});

/* ---------- Hot Potato ---------- */
test("hot potato: turns go around; timers shrink 8, 6, then 5 seconds", () => {
  const G = potato(3);
  assert.equal(G.phase, "turn"); assert.equal(G.actor, "u0");
  const ms = [];
  let t = 100;
  for (let i = 0; i < 9; i++) {
    ms.push(G.deadline - G.phaseAt);
    const who = G.actor;
    assert.ok(L.addAnswer(G, who, ["apple", "banana", "cherry", "grape", "melon", "lemon", "peach", "plum", "kiwi"][i], t).ok);
    L.tick(G, DATA, G.deadline, first); // window closes, nobody challenged
    t = G.phaseAt + 1;
  }
  assert.deepEqual(ms, [8000, 8000, 8000, 6000, 6000, 6000, 5000, 5000, 5000]);
});
test("hot potato knockouts: a repeat, a rejected answer and a timeout each knock a player out with a drink moment", () => {
  const G = potato(4);
  L.addAnswer(G, "u0", "Milk", 10); L.tick(G, DATA, G.deadline, first);           // u0 ok
  const r = L.addAnswer(G, "u1", "milks", 20);                                     // u1 repeats
  assert.ok(r.dup && r.out); assert.deepEqual(G.out.map((o) => o.why), ["repeat"]);
  assert.equal(G.actor, "u2");
  L.addAnswer(G, "u2", "Socks", 30); assert.equal(G.phase, "window");
  assert.equal(L.challenge(G, "u2", G.current), false);
  assert.ok(L.challenge(G, "u3", G.current));
  L.tick(G, DATA, G.deadline, first); assert.equal(G.phase, "cvote");
  L.castVote(G, "u0", "a1", "d"); L.castVote(G, "u3", "a1", "d"); L.castVote(G, "u1", "a1", "u");
  L.tick(G, DATA, G.deadline, first);
  assert.deepEqual(G.out.map((o) => o.uid + ":" + o.why), ["u1:repeat", "u2:rejected"]);
  assert.equal(G.actor, "u3");
  L.tick(G, DATA, G.deadline, first);                                              // u3 times out
  assert.deepEqual(G.out.map((o) => o.why), ["repeat", "rejected", "time"]);
  assert.equal(G.phase, "result");
  assert.equal(G.outcome.winner, "u0"); assert.equal(G.outcome.second, "u3");
  assert.equal(G.scores.u0, 3); assert.equal(G.scores.u3, 1);
  assert.deepEqual(G.drinks.map((d) => d.uid), ["u1", "u2", "u3"]);
});
test("hot potato: an away player's turn runs out at once; a player who leaves is simply out", () => {
  const G = potato(4);
  L.tick(G, DATA, 1, first, { u0: true });
  assert.equal(G.out[0].uid, "u0"); assert.equal(G.out[0].why, "time");
  L.leave(G, "u1", 2);
  assert.ok(G.alive.indexOf("u1") < 0);
  assert.equal(G.drinks.filter((d) => d.uid === "u1").length, 0);
});
test("a host change mid-vote throws the challenge out and moves on", () => {
  const G = spot(3);
  L.addAnswer(G, "u0", "Milk", 10); L.challenge(G, "u1", "a0"); L.tick(G, DATA, G.deadline, first);
  assert.ok(L.dismiss(G, 5, "The host changed."));
  assert.equal(G.phase, "result"); assert.equal(G.drinks.length, 0);
});

/* ---------- the end ---------- */
test("a game ends after its rounds with standings and up to four awards", () => {
  const G = L.newGame(P(3), { mode: "spot" });
  L.startRound(G, DATA, 0, first);
  let t = 0;
  for (let r = 0; r < 3; r++) {
    t = G.deadline; L.tick(G, DATA, t, first);
    const a = G.actor;
    for (let i = 0; i < r + 2; i++) L.addAnswer(G, a, "thing " + "abcdefgh"[i] + r, t + 500 * (i + 1));
    if (r === 1) { L.challenge(G, G.order.find((u) => u !== a), "a0"); }
    t = G.deadline; L.tick(G, DATA, t, first);
    if (G.phase === "cvote") { t = G.deadline; L.tick(G, DATA, t, first); }
    t = G.deadline; L.tick(G, DATA, t, first);
  }
  assert.equal(G.phase, "end");
  const titles = G.end.awards.map((a) => a.title);
  assert.deepEqual(titles, ["Fastest Mouth", "Most Challenged", "Category Royalty", "Brain Freeze"]);
  assert.equal(G.end.standings.length, 3);
});
test("players: 3 to 10", () => {
  assert.throws(() => L.newGame(P(2))); assert.throws(() => L.newGame(P(11)));
  assert.equal(L.newGame(P(10)).order.length, 10);
});
