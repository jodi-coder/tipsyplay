const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../play/poster-logic.js");
const split = require("../data/split-decision.js");

test("decks meet the authored minimums and stay unique", () => {
  assert.deepEqual(L.checkDeck(split, 72, ["conveniences", "travel", "food", "household", "powers", "dilemmas"]), []);
  const seen = new Set();
  split.forEach((card) => {
    const key = card.q.toLowerCase().replace(/\s+/g, " ").trim();
    assert.equal(seen.has(key), false, key);
    seen.add(key);
  });
});

test("deal does not repeat until the bag wraps", () => {
  const ids = split.map((card) => card.id);
  let used = [];
  const seen = [];
  for (let n = 0; n < 9; n++) {
    const deal = L.dealIds(ids, "room", used, 8);
    deal.dealt.forEach((id) => {
      if (n < 9) seen.push(id);
    });
    used = deal.used;
  }
  assert.equal(new Set(seen.slice(0, 72)).size, 72);
});

test("split seals parse a pick, then a pick and a guess", () => {
  assert.deepEqual(L.parseSplitSeal("A"), { pref: "A", pred: null });
  assert.deepEqual(L.parseSplitSeal("B|3"), { pref: "B", pred: 3 });
  assert.deepEqual(L.parseSplitSeal(""), { pref: null, pred: null });
  assert.deepEqual(L.parseSplitSeal("pass"), { pref: null, pred: null });
  assert.equal(L.encodeSplitSeal("A", 2), "A|2");
  assert.equal(L.encodeSplitSeal("B", null), "B");
});

test("production invite urls stay on the first-party https game page", () => {
  assert.equal(
    L.inviteUrl("https://tipsyplay.com", "/games/split-decision.html", "ABCD", "split"),
    "https://tipsyplay.com/games/split-decision.html?room=ABCD&game=split"
  );
  assert.equal(
    L.inviteUrl("https://tipsyplay.com", "/games/never-have-i-ever.html", "WXYZ", "nhie"),
    "https://tipsyplay.com/games/never-have-i-ever.html?room=WXYZ&game=nhie"
  );
  assert.equal(
    L.inviteUrl("http://127.0.0.1:8765", "/games/split-decision.html", "TEST", "split"),
    "http://127.0.0.1:8765/games/split-decision.html?room=TEST&game=split"
  );
});
