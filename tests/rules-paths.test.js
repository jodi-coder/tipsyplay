/* Every database path the Punchline Duel, Odd Word Out, Five Letter Frenzy, Hot Take Court and Category Countdown phones write must have a rule.
   A missing rule fails silently in the stubbed browser tests but is denied by Firebase. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const rules = JSON.parse(fs.readFileSync(path.join(root, "database.rules.json"), "utf8")).rules.rooms.$code;

for (const [file, game] of [["quiplash-party.js", "ql"], ["mole-party.js", "ml"], ["frenzy-party.js", "fl"], ["court-party.js", "hc"], ["countdown-party.js", "cc"]]) {
  test(file + " only writes paths that the rules define", () => {
    const src = fs.readFileSync(path.join(root, "play", file), "utf8");
    const used = new Set();
    for (const m of src.matchAll(/rpath\("(ql|ml|fl|hc|cc)\/([a-z]+)/g)) used.add(m[2]);
    assert.ok(used.size > 2, "found the paths");
    for (const p of used) assert.ok(rules[game][p], game + "/" + p + " has no rule");
  });
}
test("both rules files are identical", () => {
  assert.strictEqual(fs.readFileSync(path.join(root, "database.rules.json"), "utf8"), fs.readFileSync(path.join(root, "firebase-rules.json"), "utf8"));
});
