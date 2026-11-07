const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../play/poster-logic.js");
const split = require("../data/split-decision.js");
const vibe = require("../data/vibe-checkpoint.js");
const crew = require("../data/chaos-crew.js");

test("decks meet the authored minimums and stay unique", () => {
  assert.deepEqual(L.checkDeck(split, 72, ["conveniences", "travel", "food", "household", "powers", "dilemmas"]), []);
  assert.deepEqual(L.checkDeck(vibe, 60, ["hospitality", "fame", "upgrades", "robots", "errands"]), []);
  assert.deepEqual(L.checkDeck(crew, 60, ["business", "rescues", "festivals", "deliveries", "creatures"]), []);
  const seen = new Set();
  split.concat(vibe).forEach((card) => {
    const key = card.q.toLowerCase().replace(/\s+/g, " ").trim();
    assert.equal(seen.has(key), false, key);
    seen.add(key);
  });
  crew.forEach((card) => {
    assert.equal(card.roles.length, 4, card.id);
    assert.equal(new Set(card.roles).size, 4, card.id);
    card.roles.forEach((role) => assert.ok(role && role.length > 2, card.id));
  });
  vibe.forEach((card) => {
    assert.equal(card.scale.length, 5, card.id);
    assert.notEqual(card.scale[0], card.scale[4], card.id);
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

test("vibe boundaries, spotlight, and fair cycle", () => {
  assert.equal(L.vibePoints(1, 1).points, 2);
  assert.equal(L.vibePoints(2, 1).points, 1);
  assert.equal(L.vibePoints(5, 1).points, 0);
  assert.equal(L.vibePoints(5, 5).points, 2);
  assert.equal(L.vibePoints(4, 5).points, 1);
  assert.equal(L.vibePoints(1, 5).points, 0);
  assert.equal(L.vibePoints("pass", 3).points, 0);
  const roster = ["a", "b", "c"];
  const scored = L.scoreVibeRound("a", "5", L.guessersFor(roster, "a"), {a:"1", b:"4", c:"5"});
  assert.equal(scored.rows.some((row) => row.uid === "a"), false);
  assert.equal(scored.rows.find((row) => row.uid === "b").points, 1);
  assert.equal(scored.rows.find((row) => row.uid === "c").points, 2);
  const skipped = L.scoreVibeRound("a", "pass", L.guessersFor(roster, "a"), {b:"3"});
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.rows.length, 0);
  const cycle = L.cycleRoster(roster);
  const turns = cycle.map((uid) => L.guessersFor(cycle, uid).length);
  assert.deepEqual(turns, [2, 2, 2]);
  const passes = L.noteSpotlightPass({}, "a");
  const next = L.nextSpotlight(roster, 1, () => true, passes);
  assert.equal(next.uid, "b");
  const gone = L.nextSpotlight(["a"], 0, () => false, {});
  assert.equal(gone, null);
});

test("crew quotas, perfect fill, all-same, retry, and reset", () => {
  for (let n = 2; n <= 10; n++) {
    const assigned = L.assignQuotas(n, "n" + n);
    assert.ok(assigned.quotas.every((q) => q > 0));
    assert.equal(assigned.quotas.reduce((sum, q) => sum + q, 0), n);
    assert.equal(assigned.roles.length, assigned.quotas.length);
    assert.ok(assigned.roles.length >= 2 && assigned.roles.length <= 4);
    assert.equal(new Set(assigned.roles).size, assigned.roles.length);
  }
  const roles = [0, 1, 2];
  const quotas = [1, 1, 2];
  const perfect = L.staffed([0, 1, 2, 2], roles, quotas);
  assert.equal(perfect.perfect, true);
  assert.equal(perfect.filled, 4);
  const piled = L.staffed([0, 0, 0, 0], roles, quotas);
  assert.equal(piled.filled, 1);
  assert.equal(piled.perfect, false);
  assert.deepEqual(L.awardStar(false, true), {starred:true, added:1});
  assert.deepEqual(L.awardStar(true, true), {starred:true, added:0});
  assert.deepEqual(L.awardStar(false, false), {starred:false, added:0});
  const dropped = L.crewDrop({live:["a","b","c"], out:[], gen:1, resets:0, mission:0, try:0, stars:0, knownStar:false}, ["c"], "seed");
  assert.equal(dropped.cleared, true);
  assert.equal(dropped.pause, false);
  assert.deepEqual(dropped.live, ["a", "b"]);
  assert.equal(dropped.gen, 2);
  assert.equal(L.activePicks({a:"0", b:"1", c:"2"}, {a:L.crewMark(1, false), b:L.crewMark(1, false), c:L.crewMark(1, false)}, dropped.gen, dropped.live).a, undefined);
  const again = L.crewDrop(dropped, ["b"], "seed2");
  assert.equal(again.pause, true);
  const retry = L.crewRetry({live:["a","b"], gen:2, mission:1, try:0, stars:1, knownStar:true, resets:0}, "retry");
  assert.equal(retry.try, 1);
  assert.equal(retry.knownStar, true);
  assert.equal(L.crewRetry(retry, "nope"), null);
  assert.equal(L.roundKeyForCrew(7, 1), 15);
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
    L.inviteUrl("http://127.0.0.1:8765", "/games/chaos-crew.html", "CREW", "crew"),
    "http://127.0.0.1:8765/games/chaos-crew.html?room=CREW&game=crew"
  );
});
