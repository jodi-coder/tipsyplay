/* Where the Playwright guard writes its counts. Kept out of the repo. */
const path = require("path");
const os = require("os");
const STATS = process.env.TIPSY_GUARD_STATS || path.join(os.tmpdir(), "tipsyplay-guard-stats.json");
const LOG = process.env.TIPSY_GUARD_LOG || path.join(os.tmpdir(), "tipsyplay-guard.log");
module.exports = { STATS, LOG };
