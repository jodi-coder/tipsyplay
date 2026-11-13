/* Vault Traitor rules. Run: node --test vault-logic.test.js
   Set VT_LOG=/path/file.txt to also write the five walkthrough logs to a file. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const L = require("../play/vault-logic.js");

/* ---------- scoring ---------- */
test("scoring: the five cases from the spec", () => {
  assert.deepEqual(L.score("1123", "1111"), { b: 2, w: 0 });
  assert.deepEqual(L.score("1234", "4321"), { b: 0, w: 4 });
  assert.deepEqual(L.score("1123", "3211"), { b: 0, w: 4 });
  assert.deepEqual(L.score("1100", "0011"), { b: 0, w: 4 });
  assert.deepEqual(L.score("5555", "5000"), { b: 1, w: 0 });
});
test("scoring: black is counted first and white only from the leftover digits", () => {
  assert.deepEqual(L.score("1234", "1234"), { b: 4, w: 0 });
  assert.deepEqual(L.score("1122", "2211"), { b: 0, w: 4 });
  assert.deepEqual(L.score("1222", "2111"), { b: 0, w: 2 });
  assert.deepEqual(L.score("0000", "1111"), { b: 0, w: 0 });
  // every pair over a sample space never exceeds 4 pegs
  for (let i = 0; i < 2000; i++) {
    const c = String(i * 7919 % 10000).padStart(4, "0"), g = String(i * 104729 % 10000).padStart(4, "0");
    const f = L.score(c, g);
    assert.ok(f.b + f.w <= 4 && f.b >= 0 && f.w >= 0, c + " " + g);
  }
});

/* ---------- lies ---------- */
test("lie validation: no value below 0 or above 4, black + white at most 4, never a fake 4 exact", () => {
  for (let b = 0; b <= 4; b++) for (let w = 0; b + w <= 4; w++) {
    const opts = L.lieOptions({ b, w });
    opts.forEach((o) => {
      assert.ok(o.b >= 0 && o.b <= 4 && o.w >= 0 && o.w <= 4, JSON.stringify(o));
      assert.ok(o.b + o.w <= 4, JSON.stringify(o));
      assert.notEqual(o.b, 4, "a lie may never show 4 exact");
      assert.equal(Math.abs(o.b - b) + Math.abs(o.w - w), 1, "a lie moves one number by one");
    });
    // the options are exactly the valid ones: compare with a brute-force list
    const brute = [["b+1", b + 1, w], ["b-1", b - 1, w], ["w+1", b, w + 1], ["w-1", b, w - 1]]
      .filter(([, nb, nw]) => b < 4 && nb >= 0 && nb <= 4 && nw >= 0 && nw <= 4 && nb + nw <= 4 && nb !== 4).map((x) => x[0]);
    assert.deepEqual(opts.map((o) => o.key), brute, `feedback ${b}/${w}`);
  }
  assert.equal(L.applyLie({ b: 0, w: 2 }, "b-1"), null);
  assert.equal(L.applyLie({ b: 2, w: 2 }, "w+1"), null);
  assert.equal(L.applyLie({ b: 3, w: 0 }, "b+1"), null);
});
test("lie validation: no lie is offered when none is valid (a cracked code), and nobody is asked", () => {
  assert.deepEqual(L.lieOptions({ b: 4, w: 0 }), []);
  const g = setup(["A", "B", "C"], "sips", "4271", ["C"]);
  const r = L.submitGuess(g, "A", "4271");
  assert.equal(r.win, true);
  assert.equal(r.liars, undefined);
  assert.deepEqual(L.liars(g), []);
});
test("lies: two per Traitor, at most one per guess, and the group sees only the lied version", () => {
  const g = setup(["A", "B", "C", "D", "E", "F"], "sips", "4271", ["E", "F"]);
  L.submitGuess(g, "A", "1234");
  assert.deepEqual(L.liars(g).sort(), ["E", "F"]);
  const e = L.seal(g, { uid: "E", key: "w-1" });
  assert.deepEqual(e.truth, { b: 1, w: 2 });
  assert.deepEqual(e.shown, { b: 1, w: 1 });
  assert.equal(g.liesLeft.E, 1);
  assert.equal(g.lies.length, 1, "one lie for this guess, even with two Traitors");
  L.nextTurn(g); L.submitGuess(g, "B", "4000"); L.seal(g, { uid: "E", key: "b-1" });
  assert.equal(g.liesLeft.E, 0);
  L.nextTurn(g); L.submitGuess(g, "C", "4200");
  assert.deepEqual(L.liars(g), ["F"], "E has no lies left");
  const ignored = L.seal(g, { uid: "E", key: "b-1" });
  assert.equal(ignored.lieBy, null, "a Traitor with no lies left tells the truth");
});

/* ---------- votes ---------- */
test("majority: exactly half is not a majority, and a tie costs one guess", () => {
  const act = ["A", "B", "C", "D"];
  assert.equal(L.tally({ A: "C", B: "C", C: "A", D: "B" }, act).majority, false, "2 of 4 is not a majority");
  assert.equal(L.tally({ A: "C", B: "C", D: "C" }, act).majority, true, "3 of 4 is");
  assert.equal(L.tally({ A: "A", B: "A", C: "A" }, act).majority, false, "self-votes are ignored");
  const g = setup(["A", "B", "C", "D"], "sips", "4271", ["D"]);
  const before = L.guessesLeft(g);
  const rec = L.vote(g, "A", { A: "D", B: "D", C: "B", D: "B" });
  assert.equal(rec.result, "tie");
  assert.equal(L.guessesLeft(g), before - 1);
  assert.equal(g.removed.D, undefined);
});
test("votes: a correct accusation removes the Traitor and exposes their lies; a wrong one costs two guesses", () => {
  const g = setup(["A", "B", "C", "D", "E", "F"], "sips", "4271", ["E", "F"]);
  L.submitGuess(g, "A", "1234"); L.seal(g, { uid: "E", key: "w+1" });
  const ok = L.vote(g, "B", { A: "E", B: "E", C: "E", D: "E" });
  assert.equal(ok.result, "correct");
  assert.equal(g.removed.E, "caught");
  assert.equal(g.lies[0].exposed, true);
  const before = L.guessesLeft(g);
  const bad = L.vote(g, "C", { A: "B", C: "B", D: "B", F: "B" });
  assert.equal(bad.result, "wrong");
  assert.equal(L.guessesLeft(g), before - 2);
  assert.equal(g.removed.B, undefined, "the wrongly accused stays");
});
test("guess counting: wrong accusations can take the count to zero, which is a Traitor win", () => {
  const g = setup(["A", "B", "C"], "sips", "4271", ["C"]);
  for (let i = 0; i < 4; i++) L.vote(g, "A", { A: "B", C: "B" });
  assert.equal(L.guessesLeft(g), 2);
  assert.equal(g.winner, null);
  L.vote(g, "A", { A: "B", C: "B" });
  assert.equal(L.guessesLeft(g), 0);
  assert.equal(g.winner, "traitors");
  assert.equal(g.reason, "ran out of guesses");
});
test("guess counting: cracking the code on the final guess is a Codebreaker win", () => {
  const g = setup(["A", "B", "C"], "sips", "4271", ["C"]);
  for (let i = 0; i < 9; i++) { L.submitGuess(g, L.currentTurn(g), "10" + String(i).padStart(2, "0")); L.seal(g, null); L.nextTurn(g); }
  assert.equal(L.guessesLeft(g), 1);
  const r = L.submitGuess(g, L.currentTurn(g), "4271");
  assert.equal(r.win, true);
  assert.equal(g.winner, "codebreakers");
});
test("duplicates cost nothing and keep the turn; a pass uses no guess and only once", () => {
  const g = setup(["A", "B", "C"], "sips", "4271", ["C"]);
  L.submitGuess(g, "A", "1234"); L.seal(g, null); L.nextTurn(g);
  const d = L.submitGuess(g, "B", "1234");
  assert.equal(d.duplicate, true);
  assert.equal(g.used, 1);
  assert.equal(L.currentTurn(g), "B");
  assert.equal(L.usePass(g, "B").ok, true);
  assert.equal(g.used, 1);
  L.nextTurn(g); L.nextTurn(g); L.nextTurn(g);
  assert.equal(L.currentTurn(g), "B");
  assert.equal(L.usePass(g, "B").error, "none", "one token per game");
});

/* ---------- randomness ---------- */
test("uniform generation: 1,000,000 digits from crypto.getRandomValues are evenly spread", () => {
  const counts = new Array(10).fill(0);
  for (let i = 0; i < 1000000; i++) counts[L.randomDigit()]++;
  // expected 100,000 each; one standard deviation is about 300, so 1,500 is a five-sigma tolerance
  counts.forEach((c, d) => assert.ok(Math.abs(c - 100000) < 1500, `digit ${d}: ${c}`));
  test.diagnostic?.("digit counts " + counts.join(", "));
  module.exports.counts = counts;
});
test("uniform generation: rejection sampling drops bytes 250 to 255", () => {
  const bytes = [255, 250, 252, 7];
  assert.equal(L.randomDigit(() => bytes.shift()), 7);
  assert.equal(L.randomDigit(() => 249), 9);
  assert.match(L.makeCode(), /^[0-9]{4}$/);
});
test("roles: one Traitor for 3 to 5 players, two for 6 to 8", () => {
  for (let n = 3; n <= 8; n++) {
    const uids = Array.from({ length: n }, (_, i) => "p" + i);
    const roles = L.dealRoles(uids);
    const t = Object.values(roles).filter((r) => r === "traitor").length;
    assert.equal(t, n >= 6 ? 2 : 1, n + " players");
  }
  assert.throws(() => L.newGame([{ uid: "a", name: "A" }, { uid: "b", name: "B" }], "sips"));
});
test("names: unique ignoring case, not empty, at most 12 characters", () => {
  assert.equal(L.nameError("", []), "Add your name first.");
  assert.match(L.nameError("Thirteenchars", []), /12/);
  assert.match(L.nameError("jo", ["Jo"]), /already/);
  assert.equal(L.nameError("Twelve chars", ["Jo"]), "");
});

/* ---------- drinks ---------- */
test("drink resolution: several triggers on one guess make one banner listing every drinker once", () => {
  const b = L.resolveDrinks([{ type: "pass", uids: ["A"] }, { type: "wrong", uids: ["B"] }, { type: "correct", uids: ["C"] }, { type: "wrong", uids: ["A"] }], "sips");
  assert.deepEqual(b.drinkers, ["A", "B", "C"]);
  assert.equal(b.amount, "one drink");
  assert.equal(b.lines.length, 3);
  assert.equal(L.resolveDrinks([{ type: "pass", uids: ["A"] }], "shots").amount, "one shot");
  assert.equal(L.resolveDrinks([], "sips"), null);
});
test("drink resolution: No drinking produces no drinks, only alternatives", () => {
  const b = L.resolveDrinks([{ type: "pass", uids: ["A"] }, { type: "wrong", uids: ["B"] }], "none");
  assert.deepEqual(b.drinkers, []);
  assert.deepEqual(b.affected, ["A", "B"]);
  assert.equal(b.noDrinking, true);
  const g = setup(["A", "B", "C"], "none", "4271", ["C"]);
  assert.equal(L.applyChoice(g, "A", "drink"), "skipvote", "a drink is not possible under No drinking");
});
test("banner wording never names a role", () => {
  const b = L.resolveDrinks([{ type: "undetected", uids: ["A", "B"] }], "sips");
  assert.equal(b.lines[0], "Someone's lie got through. Codebreakers drink.");
  ["pass", "wrong"].forEach((t) => assert.doesNotMatch(L.resolveDrinks([{ type: t, uids: ["A"] }], "sips").lines.join(" "), /traitor/i));
});
test("leaving: a Traitor who leaves counts as removed with no drinks, and fewer than 3 players is flagged", () => {
  const g = setup(["A", "B", "C", "D"], "sips", "4271", ["D"]);
  const r = L.leave(g, "D");
  assert.equal(r.role, "traitor");
  assert.equal(g.winner, "codebreakers");
  assert.equal(L.turnDrinks(g), null);
  const h = setup(["A", "B", "C"], "sips", "4271", ["C"]);
  assert.equal(L.leave(h, "A").short, true);
});

/* ---------- walkthroughs ---------- */
function setup(names, setting, code, traitors) {
  const players = names.map((n) => ({ uid: n, name: n }));
  const g = L.newGame(players, setting);
  g.code = code;
  g.liesLeft = {};
  names.forEach((n) => { g.roles[n] = traitors.includes(n) ? "traitor" : "codebreaker"; if (traitors.includes(n)) g.liesLeft[n] = 2; });
  return g;
}
/* What the host does after a turn: private choices, then one banner. choices: {uid: "drink"|"skipvote"|"token"} */
function drinks(g, choices) {
  const b = L.turnDrinks(g);
  if (!b) return null;
  const entries = b.affected.map((u) => {
    const what = L.applyChoice(g, u, (choices || {})[u] || "drink");
    return `${u}: ${what === "drink" ? b.amount : what === "token" ? "gave up their pass token" : "skips their next vote"}`;
  });
  g.log.push("BANNER: " + b.lines.join(" ") + " | " + entries.join(", ") + (b.noDrinking ? " (No drinking)" : ""));
  return b;
}
function guess(g, code, lie) {
  const who = L.currentTurn(g);
  const r = L.submitGuess(g, who, code);
  if (r.seal) L.seal(g, lie || null);
  return r;
}
function wrapUp(g, title) {
  const f = L.finish(g);
  g.log.push(`ROUND END: ${f.winner} win (${f.reason}). Code ${f.code}. Guesses used ${f.summary.guessesUsed}, lies told ${f.summary.liesTold}, correct calls ${f.summary.correct}, wrong calls ${f.summary.wrong}.`);
  f.lies.forEach((l) => g.log.push(`  lie by ${l.by} on guess ${l.n}: ${l.key}, ${l.status}`));
  if (f.banner) g.log.push("  ROUND-END BANNER: " + f.banner.lines.join(" ") + " | " + f.banner.affected.join(", ") + (f.banner.noDrinking ? " (No drinking: nothing to do)" : ": " + f.banner.amount));
  return { title, log: g.log.slice(), f };
}
const WALKS = [];
test("walkthrough 1: a Traitor lie that gets through", () => {
  const g = setup(["Ana", "Ben", "Cat", "Dev"], "sips", "4271", ["Cat"]);
  guess(g, "1234", { uid: "Cat", key: "w-1" }); L.nextTurn(g);          // truth 0/3, shown 0/2
  guess(g, "5678"); L.nextTurn(g);                                        // 0/1
  guess(g, "4712", { uid: "Cat", key: "b-1" }); L.nextTurn(g);          // truth 2/2, shown 1/2
  guess(g, "4217"); L.nextTurn(g);                                        // 2/2
  guess(g, "4271");                                                       // cracked on guess 5
  const w = wrapUp(g, "Walkthrough 1: Traitor lie (Drinks)");
  assert.equal(w.f.winner, "codebreakers");
  assert.equal(w.f.summary.liesTold, 2);
  assert.deepEqual(w.f.banner.affected, ["Ana", "Ben", "Dev"], "undetected lies make every remaining Codebreaker drink once");
  assert.equal(w.f.banner.lines.length, 1, "no fast-crack banner after 5 guesses");
  WALKS.push(w);
});
test("walkthrough 2: a wrong accusation", () => {
  const g = setup(["Ana", "Ben", "Cat"], "shots", "9031", ["Ben"]);
  guess(g, "1234"); L.nextTurn(g);
  guess(g, "5678", { uid: "Ben", key: "w+1" });
  const v = L.vote(g, "Cat", { Ana: "Cat", Ben: "Ana", Cat: "Ana" });     // Ana accused, she's a Codebreaker
  assert.equal(v.result, "wrong");
  drinks(g, { Cat: "drink" });                                            // Cat called it, Cat drinks
  L.nextTurn(g);
  guess(g, "9012"); L.nextTurn(g);
  guess(g, "9031");
  const w = wrapUp(g, "Walkthrough 2: wrong accusation (Shots)");
  assert.equal(L.guessesLeft(g), 10 - 4 - 2);
  assert.equal(w.f.summary.wrong, 1);
  assert.ok(w.log.some((l) => l.startsWith("BANNER: Wrong call.") && l.includes("Cat: one shot")));
  WALKS.push(w);
});
test("walkthrough 3: correct accusations with two Traitors", () => {
  const g = setup(["Ana", "Ben", "Cat", "Dev", "Eli", "Fay"], "sips", "2580", ["Dev", "Fay"]);
  guess(g, "1234", { uid: "Fay", key: "b+1" }); L.nextTurn(g);          // truth 1/0 shown 2/0
  const v1 = L.vote(g, "Ana", { Ana: "Fay", Ben: "Fay", Cat: "Fay", Eli: "Fay", Dev: "Ana", Fay: "Ana" });
  assert.equal(v1.result, "correct");
  drinks(g, { Fay: "drink" });
  guess(g, "5678"); L.nextTurn(g);
  const v2 = L.vote(g, "Cat", { Ana: "Dev", Ben: "Dev", Cat: "Dev", Eli: "Ana" });
  assert.equal(v2.result, "correct");
  drinks(g, { Dev: "skipvote" });
  const w = wrapUp(g, "Walkthrough 3: correct accusations (Drinks)");
  assert.equal(w.f.winner, "codebreakers");
  assert.equal(w.f.reason, "caught every Traitor");
  assert.equal(w.f.lies[0].status, "exposed");
  assert.equal(w.f.banner, null, "no undetected lies, no fast crack");
  WALKS.push(w);
});
test("walkthrough 4: a pass token, then a fast crack", () => {
  const g = setup(["Ana", "Ben", "Cat"], "sips", "1357", ["Cat"]);
  guess(g, "1234"); L.nextTurn(g);                                        // Ana 1/1
  assert.equal(L.usePass(g, "Ben").ok, true);
  drinks(g, { Ben: "drink" });
  L.nextTurn(g);
  guess(g, "1350"); L.nextTurn(g);                                        // Cat 3/0 (Traitor tells the truth)
  guess(g, "1357");                                                       // Ana cracks on guess 3
  const w = wrapUp(g, "Walkthrough 4: pass token and fast crack (Drinks)");
  assert.equal(w.f.summary.guessesUsed, 3);
  assert.deepEqual(w.f.banner.affected, ["Cat"], "cracked in 4 or fewer: every Traitor drinks");
  assert.ok(w.log.some((l) => l.startsWith("BANNER: Pass token used.") && l.includes("Ben: one drink")));
  WALKS.push(w);
});
test("walkthrough 5: No drinking", () => {
  const g = setup(["Ana", "Ben", "Cat", "Dev", "Eli"], "none", "8642", ["Ana"]);
  guess(g, "1234", { uid: "Ana", key: "w+1" }); L.nextTurn(g);          // Ana lies on her own guess: truth 0/2, shown 0/3
  assert.equal(L.usePass(g, "Ben").ok, true);
  assert.deepEqual(L.alternatives(g, "Ben"), ["skipvote"], "token already spent, so only one alternative");
  const b1 = drinks(g, { Ben: "skipvote" });
  assert.deepEqual(b1.drinkers, []);
  L.nextTurn(g);
  guess(g, "8640");                                                       // Cat: 3/0
  const v = L.vote(g, "Cat", { Ana: "Dev", Cat: "Dev", Eli: "Dev", Ben: "Ana" });
  assert.deepEqual(v.sat, ["Ben"], "Ben sat this vote out, so his ballot doesn't count");
  assert.equal(v.result, "wrong", "3 of 5 is a majority, and Dev is a Codebreaker");
  const b2 = drinks(g, { Cat: "token" });
  assert.deepEqual(b2.drinkers, []);
  assert.equal(g.passLeft.Cat, false, "Cat gave up the pass token instead");
  L.nextTurn(g);
  guess(g, "8642");                                                       // Dev cracks on guess 3
  const w = wrapUp(g, "Walkthrough 5: No drinking");
  assert.equal(w.f.winner, "codebreakers");
  assert.equal(w.f.banner.noDrinking, true);
  assert.deepEqual(w.f.banner.drinkers, []);
  WALKS.push(w);
});
test("walkthrough logs: write them out", () => {
  assert.equal(WALKS.length, 5);
  const text = WALKS.map((w) => w.title + "\n" + w.log.map((l) => "  " + l).join("\n")).join("\n\n") + "\n";
  if (process.env.VT_LOG) fs.writeFileSync(process.env.VT_LOG, text);
});
