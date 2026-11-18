/* Hot Take Court rules. Run: node --test court-logic.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../play/court-logic.js");
const DATA = require("../data/court.js");

const first = () => 0;
const P = (n) => Array.from({ length: n }, (_, i) => ({ uid: "u" + i, name: "P" + i }));
function game(n, opts) { const G = L.newGame(P(n), opts); L.startCase(G, DATA, 0, first); return G; }
/* Walk one case up to deliberation; returns the time. */
function toDeliberation(G, t) {
  L.pickTake(G, G.defendant, 0); L.tick(G, DATA, t, first);          // -> opening
  L.rest(G, G.defendant); L.tick(G, DATA, t, first);                  // -> prosecution
  L.rest(G, G.prosecutor); L.tick(G, DATA, t, first);                 // -> deliberation
  assert.equal(G.phase, "deliberation");
  return t;
}
function voteAll(G, votes, t) { Object.keys(votes).forEach((u) => assert.equal(L.vote(G, u, votes[u]), true)); L.tick(G, DATA, t, first); }

/* ---------- content ---------- */
test("content: 150+ original takes, 50+ per pack, 30+ sentences, no banned wording, no repeats", () => {
  const all = Object.values(DATA.takes).flat();
  assert.ok(all.length >= 150);
  for (const k of ["mild", "spicy", "extra"]) assert.ok(DATA.takes[k].length >= 50, k);
  assert.ok(DATA.sentences.length >= 30);
  assert.ok(DATA.poses.length >= 8);
  const every = all.concat(DATA.sentences, DATA.poses);
  every.forEach((t) => assert.ok(!/\bsips?\b|water/i.test(t), t));
  assert.equal(new Set(every.map((t) => t.toLowerCase())).size, every.length);
});

/* ---------- phase order and timers ---------- */
test("phases run in order, each with its own deadline", () => {
  const G = game(4);
  const seen = [G.phase];
  assert.equal(G.deadline, L.T.caseMs);
  assert.equal(G.offer.length, 3);
  assert.equal(L.tick(G, DATA, L.T.caseMs - 1, first), "");
  let t = L.T.caseMs; L.tick(G, DATA, t, first); seen.push(G.phase);
  assert.ok(G.offer.includes(G.take), "no pick in time: one is chosen for them");
  assert.equal(G.deadline, t + L.T.opening);
  t += L.T.opening; L.tick(G, DATA, t, first); seen.push(G.phase);
  t += L.T.prosecution; L.tick(G, DATA, t, first); seen.push(G.phase);
  t += L.T.deliberation; L.tick(G, DATA, t, first); seen.push(G.phase); // nobody voted: hung jury
  assert.equal(G.verdict.result, "hung");
  t = G.deadline; L.tick(G, DATA, t, first); seen.push(G.phase);         // hung skips sentencing
  t = G.deadline; L.tick(G, DATA, t, first); seen.push(G.phase);
  assert.deepEqual(seen, ["case", "opening", "prosecution", "deliberation", "verdict", "scores", "case"]);
});
test("roles: the Defendant rotates, the Prosecutor is someone else, jurors are everyone left", () => {
  const G = game(5);
  const defendants = [];
  for (let i = 0; i < 5; i++) {
    defendants.push(G.defendant);
    assert.notEqual(G.prosecutor, G.defendant);
    assert.deepEqual(L.jurors(G).sort(), G.order.filter((u) => u !== G.defendant && u !== G.prosecutor).sort());
    L.dismiss(G, 0, "skip"); L.tick(G, DATA, G.deadline, first);
  }
  assert.deepEqual(defendants, ["u0", "u1", "u2", "u3", "u4"]);
});
test("only the Defendant picks, only once; only speakers can rest; objections once per juror", () => {
  const G = game(4);
  const juror = L.jurors(G)[0];
  assert.equal(L.pickTake(G, juror, 1), false);
  assert.equal(L.pickTake(G, G.defendant, 5), false);
  assert.equal(L.pickTake(G, G.defendant, 2), true);
  assert.equal(L.pickTake(G, G.defendant, 1), false);
  assert.equal(G.take, G.offer[2]);
  L.tick(G, DATA, 1, first);
  assert.equal(L.rest(G, juror), false);
  assert.equal(L.object(G, juror), false, "no objections during the opening");
  L.rest(G, G.defendant); L.tick(G, DATA, 2, first);
  assert.equal(L.object(G, juror), true);
  assert.equal(L.object(G, juror), false);
  assert.equal(L.object(G, G.defendant), false);
  assert.equal(L.object(G, G.prosecutor), false);
  assert.equal(G.phase, "prosecution", "an objection does not change the timer");
});

/* ---------- verdicts and scoring ---------- */
test("guilty: Prosecutor +1, majority jurors +1, minority 0, Defendant 0", () => {
  const G = game(5); const t = toDeliberation(G, 1);
  const [a, b, c] = L.jurors(G);
  voteAll(G, { [a]: "g", [b]: "g", [c]: "n" }, t);
  assert.equal(G.verdict.result, "guilty");
  assert.equal(G.scores[G.prosecutor], 1);
  assert.equal(G.scores[G.defendant], 0);
  assert.equal(G.scores[a], 1); assert.equal(G.scores[b], 1); assert.equal(G.scores[c], 0);
  assert.equal(G.verdict.cards.length, 3);
  assert.equal(G.deadline, t + L.T.verdictBase + 3 * L.T.verdictCard);
});
test("not guilty: Defendant +2, majority jurors +1, Prosecutor 0", () => {
  const G = game(5); const t = toDeliberation(G, 1);
  const [a, b, c] = L.jurors(G);
  voteAll(G, { [a]: "n", [b]: "n", [c]: "g" }, t);
  assert.equal(G.verdict.result, "not");
  assert.equal(G.scores[G.defendant], 2);
  assert.equal(G.scores[G.prosecutor], 0);
  assert.deepEqual([G.scores[a], G.scores[b], G.scores[c]], [1, 1, 0]);
});
test("a tie is a hung jury: nobody scores, no sentencing, nobody drinks", () => {
  const G = game(4); const t = toDeliberation(G, 1);
  const [a, b] = L.jurors(G);
  voteAll(G, { [a]: "g", [b]: "n" }, t);
  assert.equal(G.verdict.result, "hung");
  assert.ok(Object.values(G.scores).every((s) => s === 0));
  L.tick(G, DATA, G.deadline, first);
  assert.equal(G.phase, "scores");
  assert.deepEqual(G.drank, {});
  assert.equal(G.log[0].verdict, "hung");
});
test("deliberation closes early once every present juror has voted; an away juror abstains", () => {
  const G = game(5); toDeliberation(G, 1);
  const [a, b, c] = L.jurors(G);
  L.vote(G, a, "g"); L.vote(G, b, "g");
  assert.equal(L.tick(G, DATA, 2, first), "");
  assert.equal(L.tick(G, DATA, 2, first, { [c]: true }), "verdict");
  assert.equal(G.verdict.g, 2);
  assert.equal(L.vote(G, c, "n"), false, "no votes after the verdict");
});
test("only jurors vote, once, with g or n", () => {
  const G = game(4); toDeliberation(G, 1);
  const j = L.jurors(G)[0];
  assert.equal(L.vote(G, G.defendant, "n"), false);
  assert.equal(L.vote(G, G.prosecutor, "g"), false);
  assert.equal(L.vote(G, j, "x"), false);
  assert.equal(L.vote(G, j, "g"), true);
  assert.equal(L.vote(G, j, "n"), false);
});
test("one-vote margins count toward Swing Vote", () => {
  const G = game(5); const t = toDeliberation(G, 1);
  const [a, b, c] = L.jurors(G);
  voteAll(G, { [a]: "g", [b]: "g", [c]: "n" }, t);
  assert.equal(G.stats[a].swing, 1); assert.equal(G.stats[c].swing, 0);
});

/* ---------- sentencing and drinks ---------- */
test("guilty sentencing: the Defendant chooses while jurors pick a sentence; ends early when all are in", () => {
  const G = game(5); let t = toDeliberation(G, 1);
  const [a, b, c] = L.jurors(G);
  voteAll(G, { [a]: "g", [b]: "g", [c]: "g" }, t);
  L.tick(G, DATA, G.deadline, first);
  assert.equal(G.phase, "sentencing");
  assert.equal(L.chooser(G), G.defendant);
  assert.equal(G.sentenceOptions.length, 3);
  assert.equal(L.choose(G, a, "drink"), false, "a juror does not choose");
  assert.equal(L.sentVote(G, G.defendant, 0), false, "the Defendant does not vote on the sentence");
  L.sentVote(G, a, 2); L.sentVote(G, b, 2); L.sentVote(G, c, 0);
  assert.equal(L.sentVote(G, a, 1), false);
  assert.equal(L.tick(G, DATA, G.deadline - 1, first), "", "waits for the Defendant");
  L.choose(G, G.defendant, "alt");
  assert.equal(L.tick(G, DATA, G.deadline - 1, first), "scores");
  assert.equal(G.outcome.what, "alt");
  assert.equal(G.outcome.sentence, G.sentenceOptions[2]);
  assert.deepEqual(G.outcome.counts, [1, 0, 2]);
});
test("not guilty sentencing: the Prosecutor chooses drink, a pose, or Pass; passing costs nothing", () => {
  const G = game(4); const t = toDeliberation(G, 1);
  const [a, b] = L.jurors(G);
  voteAll(G, { [a]: "n", [b]: "n" }, t);
  L.tick(G, DATA, G.deadline, first);
  assert.equal(L.chooser(G), G.prosecutor);
  assert.equal(G.sentenceOptions.length, 0);
  assert.equal(L.sentVote(G, a, 0), false);
  const before = { ...G.scores };
  L.choose(G, G.prosecutor, "pass");
  L.tick(G, DATA, 2, first);
  assert.equal(G.outcome.what, "pass");
  assert.deepEqual(G.scores, before);
});
test("no choice in time counts as Pass", () => {
  const G = game(4); const t = toDeliberation(G, 1);
  const [a, b] = L.jurors(G);
  voteAll(G, { [a]: "g", [b]: "g" }, t);
  L.tick(G, DATA, G.deadline, first);
  L.tick(G, DATA, G.deadline, first);
  assert.equal(G.outcome.what, "pass"); assert.equal(G.outcome.timedOut, true);
});
test("drink cap: one drink per player per case, then the alternative; points only is always the alternative", () => {
  const G = game(4);
  assert.equal(L.drinkOrAlt(G, "u1"), "drink");
  assert.equal(L.drinkOrAlt(G, "u1"), "alt");
  assert.equal(L.drinkOrAlt(G, "u2"), "drink");
  L.dismiss(G, 0); L.tick(G, DATA, G.deadline, first);
  assert.deepEqual(G.drank, {}, "a new case clears the cap");
  const N = game(4, { na: true });
  assert.equal(L.drinkOrAlt(N, "u1"), "alt");
  const H = game(4, { na: true }); const t = toDeliberation(H, 1);
  const [a, b] = L.jurors(H); voteAll(H, { [a]: "g", [b]: "g" }, t);
  L.tick(H, DATA, H.deadline, first); L.choose(H, H.defendant, "drink"); L.sentVote(H, a, 0); L.sentVote(H, b, 0); L.tick(H, DATA, 2, first);
  assert.equal(H.outcome.what, "alt");
});

/* ---------- leaving, dismissing, the end ---------- */
test("the Defendant leaving dismisses the case; under 3 players the game ends", () => {
  const G = game(4); toDeliberation(G, 1);
  const d = G.defendant;
  L.leave(G, d, 5);
  assert.equal(G.phase, "scores"); assert.match(G.note, /left/);
  assert.ok(Object.values(G.scores).every((s) => s === 0));
  L.leave(G, G.order[0], 6);
  assert.equal(G.phase, "end");
});
test("a host change mid-verdict dismisses the case and takes back its points", () => {
  const G = game(5); const t = toDeliberation(G, 1);
  const [a, b, c] = L.jurors(G);
  voteAll(G, { [a]: "n", [b]: "n", [c]: "n" }, t);
  assert.equal(G.scores[G.defendant], 2);
  assert.equal(L.dismiss(G, t, "The host changed."), true);
  assert.ok(Object.values(G.scores).every((s) => s === 0));
  assert.equal(G.stats[G.defendant].acquitted, 0);
});
test("absent Defendant: their case is skipped, the next present player takes the stand", () => {
  const G = L.newGame(P(4));
  L.startCase(G, DATA, 0, first, { u0: true });
  assert.equal(G.defendant, "u1");
});
test("a full game ends after one case per player per lap, with standings and awards", () => {
  const G = game(3, { laps: 1 });
  let t = 1;
  for (let i = 0; i < 3; i++) {
    toDeliberation(G, t);
    const j = L.jurors(G)[0];
    voteAll(G, { [j]: i === 0 ? "n" : "g" }, t);
    L.tick(G, DATA, G.deadline, first);
    L.choose(G, L.chooser(G), "pass"); L.sentVote(G, j, 1); L.tick(G, DATA, t, first);
    t = G.deadline; L.tick(G, DATA, t, first);
  }
  assert.equal(G.phase, "end");
  assert.equal(G.played, 3);
  assert.equal(G.end.standings.length, 3);
  const titles = G.end.awards.map((a) => a.title);
  assert.ok(titles.includes("Most Convicted"));
  assert.ok(titles.includes("Smooth Talker"));
  assert.ok(titles.includes("Hanging Judge"));
  assert.ok(titles.length >= 3 && titles.length <= 4);
  const view = L.publicView(G);
  assert.ok(view.end);
});
test("awards: ties are shared; an award nobody earned is left out", () => {
  const G = L.newGame(P(3));
  G.stats.u0.convicted = 2; G.stats.u1.convicted = 2;
  const a = L.awards(G);
  assert.deepEqual(a.find((x) => x.key === "convicted").uids, ["u0", "u1"]);
  assert.equal(a.find((x) => x.key === "smooth"), undefined);
});
test("public view: never the offered takes, never a vote before the verdict", () => {
  const G = game(5);
  let v = L.publicView(G);
  assert.equal(v.take, ""); assert.equal(v.offer, undefined);
  for (const t of G.offer) assert.ok(!JSON.stringify(v).includes(t));
  toDeliberation(G, 1);
  L.vote(G, L.jurors(G)[0], "g");
  v = L.publicView(G);
  assert.equal(v.votesIn, 1); assert.equal(v.verdict, undefined); assert.ok(!/"votes"/.test(JSON.stringify(v)));
  L.tick(G, DATA, G.deadline, first);
  v = L.publicView(G);
  assert.equal(v.verdict.cards.length, 1);
});
test("players: 3 to 8, names up to 12 and unique ignoring case", () => {
  assert.throws(() => L.newGame(P(2))); assert.throws(() => L.newGame(P(9)));
  assert.ok(L.nameError("", [])); assert.ok(L.nameError("jo", ["Jo"])); assert.equal(L.nameError("Jo", []), "");
});
