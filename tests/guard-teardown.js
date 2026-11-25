const fs = require("fs");
const { STATS, LOG } = require("./guard-stats");
module.exports = async function guardTeardown() {
  let rows = [];
  try {
    rows = fs.readFileSync(STATS, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (e) {}
  const seen = new Set();
  const firebase = [];
  let analytics = 0;
  for (const row of rows) {
    const key = row.kind + "\n" + (row.title || "") + "\n" + row.url;
    if (seen.has(key)) continue;
    seen.add(key);
    if (row.kind === "firebase") firebase.push(row);
    else if (row.kind === "analytics") analytics += 1;
  }
  const lines = [
    "production-firebase-attempts: " + firebase.length,
    "analytics-aborted: " + analytics
  ];
  if (firebase.length) {
    lines.push("blocked:");
    firebase.forEach((hit) => lines.push((hit.title || "") + " " + hit.url));
  }
  const text = lines.join("\n") + "\n";
  fs.writeFileSync(LOG, text);
  console.log("\n[tipsyplay guard]\n" + text);
};
