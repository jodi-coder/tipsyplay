/* Slow Drip rules. Run: node --test drip-logic.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../play/drip-logic.js");
const DATA = require("../data/slow-drip.js");

const P3 = [{ uid: "a", name: "Jo" }, { uid: "b", name: "Sam" }, { uid: "c", name: "Priya" }];
const P4 = P3.concat([{ uid: "d", name: "Lee" }]);
const LIST = [{ cat: "Common Sayings", text: "Piece of cake" }];
const first = () => 0; // a random source that always picks the first option
function round(players, opts, text) {
  const G = L.newGame(players || P3, opts);
  L.startRound(G, [{ cat: "Test", text: text || "Piece of cake" }], 0, first);
  return G;
}
/* buzz at `now`, record bets, close the window */
function attempt(G, solver, bets, now) {
  assert.equal(L.buzz(G, solver, now, now), true);
  Object.keys(bets || {}).forEach((u) => assert.equal(L.placeBet(G, u, bets[u]), true));
  L.closeBets(G, now + L.T.bet);
  return now + L.T.bet;
}

/* ---------- answer matching ---------- */
test("matching: case, punctuation, extra spaces and accents are ignored", () => {
  assert.ok(L.matches("piece of cake", "Piece of cake"));
  assert.ok(L.matches("  PIECE   of  CAKE!! ", "Piece of cake"));
  assert.ok(L.matches("Pièce of caké", "Piece of cake"));
  assert.ok(L.matches("its a dogs life", "It's a dog's life"));
  assert.ok(L.matches("chips & guacamole", "Chips and guacamole"));
  assert.ok(L.matches("thewizardofoz", "The Wizard of Oz"), "only the spacing differs");
});
test("matching: about one typo per 8 letters", () => {
  assert.equal(L.typoBudget("Piece of cake"), 1);          // 11 letters
  assert.equal(L.typoBudget("Back to the Future"), 1);     // 15 letters
  assert.equal(L.typoBudget("Spaghetti and meatballs"), 2); // 21 letters
  assert.ok(L.matches("peice of cake", "Piece of cake"), "two letters swapped is one typo");
  assert.ok(L.matches("piece of cak", "Piece of cake"), "one letter missing");
  assert.ok(L.matches("back to the futurr", "Back to the Future"));
  assert.ok(!L.matches("peice of cak", "Piece of cake"), "two typos where one is allowed");
  assert.ok(L.matches("spagetti and meatbals", "Spaghetti and meatballs"), "two typos where two are allowed");
  assert.ok(!L.matches("spagetti and meetbals", "Spaghetti and meatballs"), "three typos");
  assert.ok(!L.matches("home alone", "Jurassic Park"));
});
test("matching: every word must be present", () => {
  assert.ok(!L.matches("piece cake", "Piece of cake"), "missing word");
  assert.ok(!L.matches("back to future", "Back to the Future"), "missing word");
  assert.ok(!L.matches("piece of the cake", "Piece of cake"), "extra word");
  assert.ok(!L.matches("cake of piece", "Piece of cake"), "wrong order");
  assert.ok(!L.matches("piece on cake", "Piece of cake"), "a short word may not be swapped for another");
  assert.ok(!L.matches("", "Piece of cake"));
  assert.ok(!L.matches("   ", "Piece of cake"));
});
test("typo counting", () => {
  assert.equal(L.typos("cake", "cake"), 0);
  assert.equal(L.typos("cak", "cake"), 1);
  assert.equal(L.typos("caek", "cake"), 1);
  assert.equal(L.typos("bake", "cake"), 1);
  assert.equal(L.typos("", "cake"), 4);
});

/* ---------- phrases ---------- */
test("phrases: at least 40, five categories, 10 to 25 letters, no repeats, no banned wording", () => {
  assert.ok(DATA.list.length >= 40);
  assert.deepEqual(Object.keys(DATA.categories), ["Common Sayings", "Food & Drink", "Things at a Party", "Famous Places", "Movie Titles"]);
  const seen = new Set();
  DATA.list.forEach((p) => {
    const n = p.text.replace(/[^A-Za-z0-9]/g, "").length;
    assert.ok(n >= 10 && n <= 25, p.text + " has " + n + " letters");
    assert.ok(!seen.has(L.fold(p.text)), "repeat: " + p.text); seen.add(L.fold(p.text));
    assert.ok(!/\bsips?\b|water/i.test(p.text), p.text);
    assert.ok(L.matches(p.text, p.text));
  });
  Object.keys(DATA.categories).forEach((c) => assert.ok(DATA.categories[c].length >= 8, c));
});
test("phrases: each one is used once per game before any repeats", () => {
  const G = L.newGame(P3), seen = [];
  for (let i = 0; i < DATA.list.length; i++) seen.push(L.pickPhrase(G, DATA.list).text);
  assert.equal(new Set(seen).size, DATA.list.length);
  assert.ok(seen.includes(L.pickPhrase(G, DATA.list).text), "the list starts over only when it is used up");
  assert.equal(G.used.length, 1);
});

/* ---------- the board and the drip schedule ---------- */
test("board: spaces and punctuation always show, about 30% of the letters start revealed", () => {
  DATA.list.concat([{ text: "It's a dog's life!" }]).forEach((p) => {
    const shown = L.initialShown(p.text), sl = L.slots(p.text);
    for (let i = 0; i < p.text.length; i++) if (!L.isLetter(p.text[i])) assert.equal(shown[i], true);
    const up = sl.filter((i) => shown[i]).length;
    assert.equal(up, Math.round(sl.length * 0.3), p.text);
    const m = L.mask(p.text, shown);
    assert.equal(m.length, p.text.length);
    assert.equal((m.match(/_/g) || []).length, sl.length - up);
  });
});
test("drip: one hidden letter every 10 seconds, from the stored deadline", () => {
  const G = round();
  const hidden = L.hiddenCount(G);
  assert.equal(G.phase, "drip"); assert.equal(G.deadline, 10000);
  assert.equal(L.tick(G, 9999, first), "");
  assert.equal(L.hiddenCount(G), hidden);
  assert.equal(L.tick(G, 10000, first), "drop");
  assert.equal(L.hiddenCount(G), hidden - 1); assert.equal(G.deadline, 20000); assert.equal(G.drops, 1);
  assert.equal(L.tick(G, 20050, first), "drop");
  assert.equal(G.deadline, 30000, "a late tick does not push the schedule back");
  assert.equal(L.tick(G, 95000, first), "drop");
  assert.equal(G.deadline, 105000, "after a long stall the next drop is a full interval away");
});
test("drip: when every letter is out the round ends, the phrase shows, and nobody drinks", () => {
  const G = round();
  let now = 0, ev = "";
  for (let i = 0; i < 40 && G.phase === "drip"; i++) { now += L.T.drip; ev = L.tick(G, now, first); }
  assert.equal(ev, "end"); assert.equal(G.phase, "end");
  assert.deepEqual(G.end, { phrase: "Piece of cake", solver: "", reason: "dripped" });
  assert.equal(G.payout, null); assert.deepEqual(G.drank, {});
  assert.deepEqual(G.scores, { a: 0, b: 0, c: 0 });
  assert.equal(L.publicView(G).mask, "Piece of cake");
});
test("buzz: the drip clock freezes and resumes where it stopped", () => {
  const G = round();
  assert.equal(L.buzz(G, "a", 4000, 4100), true);
  assert.equal(G.phase, "bet"); assert.equal(G.remain, 6000); assert.equal(G.deadline, 4100 + L.T.bet);
  assert.equal(L.buzz(G, "b", 4001, 4101), false, "a second buzz cannot win");
  assert.equal(G.solver, "a");
  L.closeBets(G, 7100);
  assert.equal(G.phase, "seat"); assert.equal(G.deadline, 7100 + L.T.seat);
  assert.equal(L.submitGuess(G, "b", "piece of cake", 8000), false, "only the solver may guess");
  L.submitGuess(G, "a", "nope", 8000, first);
  assert.equal(G.phase, "payout");
  const hidden = L.hiddenCount(G);
  assert.equal(L.tick(G, 8000 + L.T.payout, first), "drip");
  assert.equal(G.deadline, 8000 + L.T.payout + 6000);
  assert.equal(L.hiddenCount(G), hidden, "no letter dropped while the clock was frozen");
});

/* ---------- betting ---------- */
test("bets: the solver cannot bet, a pick is final, and no pick in time counts as FAIL", () => {
  const G = round(P4);
  L.buzz(G, "a", 1000, 1000);
  assert.equal(L.placeBet(G, "a", "s"), false);
  assert.equal(L.placeBet(G, "b", "s"), true);
  assert.equal(L.placeBet(G, "b", "f"), false);
  assert.equal(L.placeBet(G, "c", "x"), false);
  assert.equal(L.placeBet(G, "zz", "s"), false);
  assert.equal(L.tick(G, 1000 + L.T.bet - 1, first), "", "the window stays open while someone has not picked");
  assert.equal(L.tick(G, 1000 + L.T.bet, first), "seat");
  assert.deepEqual(G.bets, { b: "s", c: "f", d: "f" });
  assert.deepEqual(G.missed, { c: true, d: true });
  assert.equal(L.placeBet(G, "c", "s"), false, "no bets after the window closes");
});
test("bets: the window closes early once everyone has picked, and an away phone is passed, not failed", () => {
  const G = round(P4);
  L.buzz(G, "a", 1000, 1000);
  L.placeBet(G, "b", "f"); L.placeBet(G, "c", "p");
  assert.equal(L.tick(G, 1500, first, { d: true }), "seat");
  assert.deepEqual(G.bets, { b: "f", c: "p", d: "p" });
  assert.deepEqual(G.missed, {});
});
test("bets stay out of the public view until the payout", () => {
  const G = round(P4);
  L.buzz(G, "a", 1000, 1000); L.placeBet(G, "b", "s");
  let v = L.publicView(G);
  assert.equal(v.payout, null); assert.equal(v.betsIn, 1); assert.ok(!JSON.stringify(v).includes("Piece"));
  L.closeBets(G, 4000);
  v = L.publicView(G);
  assert.equal(v.payout, null); assert.ok(!/"bets"/.test(JSON.stringify(v)));
  L.submitGuess(G, "a", "wrong", 5000, first);
  v = L.publicView(G);
  assert.deepEqual(v.payout.bets, { b: "s", c: "f", d: "f" });
  assert.ok(!JSON.stringify(v).includes("Piece of cake"), "the phrase is still hidden after a wrong guess");
});

/* ---------- payout: the four outcomes ---------- */
const who = (p) => p.drinks.map((d) => d.uid + ":" + d.what + ":" + d.why);
test("payout 1: correct solve. Solver safe, SOLVE bets safe, FAIL bets drink", () => {
  const G = round(P4);
  const t = attempt(G, "a", { b: "s", c: "f", d: "p" }, 1000);
  L.submitGuess(G, "a", "Piece of Cake", t + 100, first);
  assert.equal(G.payout.correct, true);
  assert.deepEqual(who(G.payout), ["c:drink:bet FAIL"]);
  assert.deepEqual(G.payout.safe.sort(), ["a", "b", "d"]);
  assert.equal(G.phase, "end"); assert.deepEqual(G.end, { phrase: "Piece of cake", solver: "a", reason: "solved" });
  assert.equal(G.scores.a, 1);
});
test("payout 2: wrong guess. Solver drinks, SOLVE bets drink, FAIL bets safe", () => {
  const G = round(P4);
  const t = attempt(G, "a", { b: "s", c: "f", d: "p" }, 1000);
  L.submitGuess(G, "a", "slice of pie", t + 100, first);
  assert.equal(G.payout.correct, false); assert.equal(G.payout.timeout, false); assert.equal(G.payout.guess, "slice of pie");
  assert.deepEqual(who(G.payout), ["a:drink:wrong guess", "b:drink:bet SOLVE"]);
  assert.deepEqual(G.payout.safe.sort(), ["c", "d"]);
  assert.equal(G.phase, "payout"); assert.equal(G.scores.a, 0);
});
test("payout 3: the hot seat runs out. Same as a wrong guess", () => {
  const G = round(P4);
  const t = attempt(G, "a", { b: "s", c: "f" }, 1000); // d never picks: counts as FAIL
  assert.equal(L.tick(G, t + L.T.seat - 1, first), "");
  assert.equal(L.tick(G, t + L.T.seat, first), "payout");
  assert.equal(G.payout.timeout, true);
  assert.deepEqual(who(G.payout), ["a:drink:ran out of time", "b:drink:bet SOLVE"]);
  assert.deepEqual(G.payout.safe.sort(), ["c", "d"]);
  assert.deepEqual(G.payout.missed, { d: true });
});
test("payout 4: a missed bet counts as FAIL, so it drinks when the solver is right", () => {
  const G = round(P4);
  const t = attempt(G, "a", { b: "s" }, 1000);
  L.submitGuess(G, "a", "piece of cake", t + 100, first);
  assert.deepEqual(who(G.payout), ["c:drink:bet FAIL", "d:drink:bet FAIL"]);
  assert.deepEqual(G.payout.missed, { c: true, d: true });
});
test("payout: every drink banner carries a no-drink alternative", () => {
  const G = round(P4);
  const t = attempt(G, "a", { b: "s" }, 1000);
  L.submitGuess(G, "a", "no", t, first);
  assert.ok(L.ALTS.includes(G.payout.alt));
  L.ALTS.forEach((a) => assert.ok(!/\bsips?\b|water/i.test(a)));
});

/* ---------- one drink per round ---------- */
test("cap: a player takes at most one drink per round, then the same penalty becomes the alternative", () => {
  const G = round(P4);
  let t = attempt(G, "a", { b: "s", c: "s", d: "f" }, 1000);
  L.submitGuess(G, "a", "wrong", t, first);
  assert.deepEqual(who(G.payout), ["a:drink:wrong guess", "b:drink:bet SOLVE", "c:drink:bet SOLVE"]);
  L.tick(G, t + L.T.payout, first);
  // second attempt in the same round: b and c lose again, d loses for the first time
  t = attempt(G, "d", { a: "f", b: "s", c: "s" }, t + L.T.payout + 100);
  L.submitGuess(G, "d", "still wrong", t, first);
  assert.deepEqual(who(G.payout), ["d:drink:wrong guess", "b:alt:bet SOLVE", "c:alt:bet SOLVE"]);
  assert.equal(G.payout.drinks[1].capped, true);
  assert.deepEqual(Object.keys(G.drank).sort(), ["a", "b", "c", "d"]);
  // a new round clears the cap
  L.startRound(G, LIST, 0, first);
  assert.deepEqual(G.drank, {});
});
test("no-alcohol setting: every penalty is the alternative", () => {
  const G = round(P4, { na: true });
  const t = attempt(G, "a", { b: "s" }, 1000);
  L.submitGuess(G, "a", "wrong", t, first);
  assert.deepEqual(G.payout.drinks.map((d) => d.what), ["alt", "alt"]);
  assert.deepEqual(G.drank, {});
});

/* ---------- penalty box ---------- */
test("penalty box: a wrong solver sits out until 2 more letters have dropped", () => {
  const G = round();
  let t = attempt(G, "a", {}, 1000);
  L.submitGuess(G, "a", "wrong", t, first);
  assert.equal(G.box.a, 2);
  t += L.T.payout; L.tick(G, t, first);
  assert.equal(G.phase, "drip");
  assert.equal(L.canBuzz(G, "a"), false); assert.equal(L.buzz(G, "a", t, t), false);
  assert.equal(L.canBuzz(G, "b"), true);
  L.tick(G, G.deadline, first);
  assert.equal(G.box.a, 1); assert.equal(L.canBuzz(G, "a"), false);
  L.tick(G, G.deadline, first);
  assert.equal(G.box.a, undefined); assert.equal(L.canBuzz(G, "a"), true);
  assert.deepEqual(L.publicView(G).box, {});
});
test("penalty box: with fewer than 2 hidden letters left, it lasts the rest of the round", () => {
  const G = round();
  while (L.hiddenCount(G) > 1) L.tick(G, G.deadline, first);
  assert.equal(L.hiddenCount(G), 1);
  const now = G.deadline - 5000;
  const t = attempt(G, "a", {}, now);
  L.submitGuess(G, "a", "wrong", t, first);
  assert.equal(G.box.a, "round");
  L.tick(G, t + L.T.payout, first);
  assert.equal(L.canBuzz(G, "a"), false);
  assert.equal(L.canBuzz(G, "b"), true);
  assert.equal(L.tick(G, G.deadline, first), "end", "the last letter ends the round");
  assert.equal(G.end.reason, "dripped");
});
test("penalty box: exactly 2 hidden letters left uses the 2-letter count", () => {
  const G = round();
  while (L.hiddenCount(G) > 2) L.tick(G, G.deadline, first);
  const t = attempt(G, "a", {}, G.deadline - 5000);
  L.submitGuess(G, "a", "wrong", t, first);
  assert.equal(G.box.a, 2);
});

/* ---------- leaving, host change, practice bots ---------- */
test("leaving: the solver's attempt is cancelled and the drip resumes; under 2 players the game ends", () => {
  const G = round(P4);
  L.buzz(G, "a", 4000, 4000); L.placeBet(G, "b", "s");
  L.leave(G, "a", 5000);
  assert.equal(G.phase, "drip"); assert.equal(G.deadline, 11000); assert.equal(G.payout, null);
  assert.deepEqual(G.order, ["b", "c", "d"]);
  L.leave(G, "b", 5000); L.leave(G, "c", 5000);
  assert.equal(G.phase, "over");
});
test("host change: the round is voided, the phrase shows, nobody drinks", () => {
  const G = round(P4);
  L.buzz(G, "a", 4000, 4000);
  assert.equal(L.voidRound(G), true);
  assert.equal(G.phase, "end"); assert.deepEqual(G.end, { phrase: "Piece of cake", solver: "", reason: "void" });
  assert.equal(G.payout, null); assert.deepEqual(G.scores, { a: 0, b: 0, c: 0, d: 0 });
  assert.equal(L.voidRound(G), false);
});
test("the game state survives a save and reload (the host's phone can refresh)", () => {
  const G = round(P4);
  L.buzz(G, "a", 4000, 4000);
  const H = JSON.parse(JSON.stringify(G));
  L.placeBet(H, "b", "s"); L.closeBets(H, 7000);
  L.submitGuess(H, "a", "piece of cake", 8000, first);
  assert.equal(H.phase, "end"); assert.equal(H.scores.a, 1);
});
test("bots: a buzz gets more likely as more letters show", () => {
  let last = 0;
  for (let f = 0; f <= 1.0001; f += 0.1) { const p = L.botBuzzChance(f, 250); assert.ok(p > last && p < 1); last = p; }
  assert.ok(L.botBuzzChance(0.3, 250) < 0.01);
  assert.ok(L.botKnowsChance(0.9) > L.botKnowsChance(0.4));
});
test("names: required, at most 12 characters, unique ignoring case; 3 to 10 players", () => {
  assert.ok(L.nameError("", []));
  assert.ok(L.nameError("ABCDEFGHIJKLM", []));
  assert.ok(L.nameError("jo", ["Jo"]));
  assert.equal(L.nameError("Jo", ["Sam"]), "");
  assert.throws(() => L.newGame(P3.slice(0, 2)));
  assert.throws(() => L.newGame(Array.from({ length: 11 }, (_, i) => ({ uid: "u" + i, name: "P" + i }))));
  assert.equal(L.newGame(Array.from({ length: 10 }, (_, i) => ({ uid: "u" + i, name: "P" + i }))).order.length, 10);
});
