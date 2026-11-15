/* Five Letter Frenzy rules. Run: node --test frenzy-logic.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../play/frenzy-logic.js");
const W = require("../data/frenzy-words.js");

function people(ids){ return ids.map((u) => ({ uid: u, name: u })); }
function round(word, extra){
  L.useWords({ answers: ["crane", "house", "stone", "music", "boozy"], guesses: ["crane", "house", "stone", "music", "boozy", "crate", "trace", "alley", "books", "bobos"] });
  return L.newRound(people(["Jo", "Sam", "Priya"]), Object.assign({ word: word || "crane" }, extra));
}

test("names reject blanks, duplicates and anything past 12 characters", () => {
  assert.equal(L.nameError("", []), "Add your name first.");
  assert.equal(L.nameError("Ada", ["ada"]), "Someone already has that name. Try another.");
  assert.equal(L.nameError("Ada", []), "");
  assert.match(L.nameError("abcdefghijklm", []), /12/);
});

test("marks count locked letters before moved ones, and spare copies only", () => {
  assert.deepEqual(L.markGuess("crane", "crane"), ["locked", "locked", "locked", "locked", "locked"]);
  assert.deepEqual(L.markGuess("crane", "crate"), ["locked", "locked", "locked", "absent", "locked"]);
  // secret alley (a, l, l, e, y), guess llama (l, l, a, m, a): one l locks, the other l moves, one a moves
  assert.deepEqual(L.markGuess("alley", "llama"), ["moved", "locked", "moved", "absent", "absent"]);
  // secret books, guess bobos: the second o moves, the extra b does not
  assert.deepEqual(L.markGuess("books", "bobos"), ["locked", "locked", "absent", "moved", "locked"]);
  assert.equal(L.pointsFor(L.markGuess("crane", "crate"), false), 4);
  assert.equal(L.pointsFor(L.markGuess("crane", "crane"), true), 8);
});

test("a guess must be five letters, on the list, and not a repeat", () => {
  L.useWords(W);
  assert.equal(L.guessError("cat", []), "Use 5 letters.");
  assert.equal(L.guessError("zzzzz", []), "That word is not on the list.");
  assert.equal(L.guessError("crane", ["crane"]), "Already guessed.");
  assert.equal(L.guessError("CRANE", []), "");
});

test("the seat that starts rotates, and a disconnected seat is skipped", () => {
  const ids = ["Jo", "Sam", "Priya", "Dee"];
  assert.equal(L.openingTurn(ids, 0, {}), "Jo");
  assert.equal(L.openingTurn(ids, 1, {}), "Sam");
  assert.equal(L.openingTurn(ids, 5, {}), "Sam");
  assert.equal(L.openingTurn(ids, 0, { Jo: false }), "Sam");
});

test("a wrong guess opens the prompt; Pass moves the turn; points-only and a dry player skip it", () => {
  let g = round();
  assert.equal(g.turn, "Jo");
  let r = L.submitGuess(g, "Jo", "house", {});
  assert.equal(r.solved, false);
  assert.equal(g.phase, "prompt");
  assert.equal(L.choose(g, "Jo", "pass", {}).ok, true);
  assert.equal(g.phase, "guess");
  assert.equal(g.turn, "Sam");
  assert.equal(g.log[0].kind, "pass");

  g = round("crane", { pointsOnly: true });
  L.submitGuess(g, "Jo", "house", {});
  assert.equal(g.phase, "guess");
  assert.equal(g.turn, "Sam");
  assert.equal(g.log[0].auto, true);

  g = round();
  g.players[1].dry = true;
  L.submitGuess(g, "Jo", "house", {});
  L.choose(g, "Jo", "drink", {});
  assert.equal(g.turn, "Sam");
  L.submitGuess(g, "Sam", "stone", {}, true);
  assert.equal(g.phase, "guess");
  assert.equal(g.turn, "Priya");
});

test("the solver skips the prompt and may hand one action that the other person can pass", () => {
  const g = round();
  const r = L.submitGuess(g, "Jo", "crane", {});
  assert.equal(r.solved, true);
  assert.equal(g.phase, "handoff");
  assert.equal(g.score.Jo, 8);
  assert.equal(L.hand(g, "Jo", "Sam", {}).waiting, true);
  assert.equal(g.turn, "Sam");
  assert.equal(L.answerHand(g, "Sam", "pass").ok, true);
  assert.equal(g.phase, "end");
  assert.equal(g.log[0].handed, true);
  assert.equal(g.log[0].kind, "pass");
});

test("skipping the handoff ends the round without an action", () => {
  const g = round();
  L.submitGuess(g, "Jo", "crane", {});
  assert.equal(L.hand(g, "Jo", null, {}).ok, true);
  assert.equal(g.phase, "end");
  assert.equal(g.log.length, 1);
  assert.equal(g.log[0].kind, "pass");
});

test("points-only solving ends with no handoff", () => {
  const g = round("crane", { pointsOnly: true });
  L.submitGuess(g, "Jo", "crane", {});
  assert.equal(g.phase, "end");
  assert.equal(g.score.Jo, 8);
});

test("six wrong guesses end the round and the word stays off the public view until then", () => {
  const g = round();
  const words = ["house", "stone", "music", "crate", "trace", "books"];
  words.forEach((w, i) => {
    const seat = g.turn;
    const r = L.submitGuess(g, seat, w, {});
    if (i < 5) {
      assert.equal(g.phase, "prompt");
      L.choose(g, seat, "pass", {});
    } else {
      assert.equal(r.ended, true);
      assert.equal(g.phase, "end");
    }
  });
  assert.equal(g.guesses.length, 6);
  assert.equal(g.solvedBy, null);
  const mid = L.publicView(Object.assign({}, g, { phase: "guess" }));
  assert.equal(mid.word, undefined);
  const end = L.publicView(g);
  assert.equal(end.word, "crane");
  assert.equal(end.awards.solvedBy, null);
  assert.ok(end.awards.closest);
});

test("a host skip counts as Pass and does not fill a row; a disconnected turn is skipped once", () => {
  let g = round();
  assert.equal(L.skipTurn(g, {}).ok, true);
  assert.equal(g.guesses.length, 0);
  assert.equal(g.turn, "Sam");
  assert.equal(g.log[0].kind, "pass");
  assert.equal(g.log[0].skippedGuess, true);

  g = round();
  L.submitGuess(g, "Jo", "house", {});
  assert.equal(g.phase, "prompt");
  assert.equal(L.skipTurn(g, {}).ok, true);
  assert.equal(g.phase, "guess");
  assert.equal(g.log[0].host, true);

  g = round();
  assert.equal(L.skipDisconnected(g, { Jo: false }), true);
  assert.equal(g.turn, "Sam");
  assert.equal(L.skipDisconnected(g, { Jo: false }), false);
});

test("pause blocks guesses, and removing the current player advances the seat", () => {
  const g = round();
  assert.equal(L.setPaused(g, true), true);
  assert.equal(L.submitGuess(g, "Jo", "house", {}).ok, false);
  L.setPaused(g, false);
  L.removePlayer(g, "Jo", {});
  assert.equal(g.order.includes("Jo"), false);
  assert.equal(g.turn, "Sam");
  assert.equal(g.phase, "guess");
});

test("awards name the most locked letters, the closest miss, and who solved it", () => {
  const g = round();
  L.submitGuess(g, "Jo", "crate", {}); // 4 locked
  L.choose(g, "Jo", "pass", {});
  L.submitGuess(g, "Sam", "crane", {});
  L.hand(g, "Sam", null, {});
  const a = L.awards(g);
  assert.equal(a.solvedBy, "Sam");
  assert.equal(a.word, "crane");
  assert.equal(a.closest.uid, "Jo");
  assert.equal(a.closest.locked, 4);
  assert.ok(a.mostLocks.uids.includes("Sam"));
});

test("newRound rejects the wrong number of players", () => {
  L.useWords({ answers: ["crane"], guesses: ["crane"] });
  assert.throws(() => L.newRound(people(["A", "B"]), { word: "crane" }));
  assert.throws(() => L.newRound(people(["A", "B", "C", "D", "E", "F", "G", "H", "I"]), { word: "crane" }));
});

test("the shipped lists keep boozy, drop the blocked examples, and answers are all guessable", () => {
  assert.equal(W.answers.includes("boozy"), true);
  assert.ok(W.answers.length >= 1000, W.answers.length);
  assert.ok(W.guesses.length > W.answers.length);
  for (const w of ["jesus", "allah", "islam", "hindu", "nigger", "naked", "drunk", "babes", "butts", "booty", "paris", "james", "david", "maria", "raper", "jewed", "homos", "lynch", "gooky", "sodom", "porns", "porny", "sexed", "nuder", "knobs", "erect", "humps", "cocky", "dicky", "kinks", "panty", "thong", "noose", "tramp", "urine", "gypsy", "slurs", "bawdy", "nippy", "sexes", "moans", "slave", "vicar", "sects", "prays", "idiot", "screw", "damns", "kills", "death", "drugs", "vomit", "paddy", "queer", "butty"]) {
    assert.equal(W.guesses.includes(w), false, w);
    assert.equal(W.answers.includes(w), false, w);
  }
  const set = new Set(W.guesses);
  W.answers.forEach((w) => {
    assert.equal(w.length, 5);
    assert.equal(set.has(w), true);
  });
  ["party", "house", "crane", "olive", "tipsy", "fizzy", "limey", "tangy", "foamy", "vodka"].forEach((w) => {
    assert.equal(W.answers.includes(w), true, w);
  });
  L.useWords(W);
  assert.equal(L.guessError("pious", []), "");
  assert.equal(L.guessError("raper", []), "That word is not on the list.");
  for (const w of ["jihad", "fatwa", "bombs", "meths", "slain"]) {
    assert.equal(W.guesses.includes(w), false, w);
    assert.equal(W.answers.includes(w), false, w);
    assert.equal(L.guessError(w, []), "That word is not on the list.", w);
  }
  const crypto = require("crypto");
  const answerHash = crypto.createHash("sha256").update(W.answers.join("\n") + "\n").digest("hex");
  assert.equal(W.answers.length, 1346);
  assert.equal(answerHash, "62b56f5b5a6e6ba6aab28899934ef8b623d4f6fd033af8d456cef033a07d2215");
});
