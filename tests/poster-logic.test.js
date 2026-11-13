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

test("split scoring excludes your own vote and handles the two-player exception", () => {
  const three = L.scoreSplitRound(["a", "b", "c"], {a:"A|1", b:"A|1", c:"B|0"});
  const rowA = three.rows.find((row) => row.uid === "a");
  assert.equal(rowA.actual, 1);
  assert.equal(rowA.denom, 2);
  assert.equal(rowA.points, 2);
  assert.equal(rowA.reason, "exact");
  const rowC = three.rows.find((row) => row.uid === "c");
  assert.equal(rowC.actual, 2);
  assert.equal(rowC.points, 0);
  assert.equal(rowC.reason, "miss");

  const near = L.splitPoints(2, 1, 4);
  assert.equal(near.points, 1);
  assert.equal(near.reason, "adjacent");

  const pair = L.scoreSplitRound(["a", "b"], {a:"A|0", b:"B|0"});
  assert.equal(pair.rows.find((row) => row.uid === "a").points, 1);
  assert.equal(pair.rows.find((row) => row.uid === "b").points, 0);
  assert.equal(L.splitPoints(1, 0, 2).points, 0);
  assert.notEqual(L.splitPoints(1, 0, 2).reason, "adjacent");

  const passed = L.scoreSplitRound(["a", "b"], {a:"A|pass", b:"B|0"});
  assert.equal(passed.rows.find((row) => row.uid === "a").points, 0);
  assert.equal(passed.rows.find((row) => row.uid === "a").reason, "pass");

  const thin = L.scoreSplitRound(["a"], {a:"A|0"});
  assert.equal(thin.unscored, true);
  assert.equal(thin.rows[0].points, 0);

  const frozen = L.scoreSplitRound(["a", "b"], {a:"A|0", b:"B|0", c:"A|9"});
  assert.deepEqual(frozen.rows.map((row) => row.uid), ["a", "b"]);
  assert.equal(L.eligibleFromPref(["a", "b", "c"], {a:1, b:2, c:1}).join(","), "a,c");
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
