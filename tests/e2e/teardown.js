const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function cleanupSophyUiDirs(dir = os.tmpdir()) {
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    // Nunca remover a caixa de mensagens do aplicativo em execução.
    if (!/^sophy-ui-(?:data-|e2e-|outra-|r\d+-|artifacts$|test-|mcp-)/.test(name)) continue;
    const target = path.resolve(dir, name);
    if (path.dirname(target) !== path.resolve(dir)) continue;
    try {
      const pid = Number(fs.readFileSync(path.join(target, 'presenca', 'lock'), 'utf8'));
      if (pid > 0) { process.kill(pid, 0); continue; }
    } catch { /* perfil sem processo vivo */ }
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
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
