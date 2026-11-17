const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function cleanupSophyUiDirs(dir = os.tmpdir()) {
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith('sophy-ui-')) continue;
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

async function teardown() {
  cleanupSophyUiDirs();
}

module.exports = teardown;
module.exports.cleanupSophyUiDirs = cleanupSophyUiDirs;

if (require.main === module) cleanupSophyUiDirs();
