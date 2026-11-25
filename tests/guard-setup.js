const fs = require("fs");
const { STATS } = require("./guard-stats");
module.exports = async function guardSetup() {
  fs.writeFileSync(STATS, "");
};
