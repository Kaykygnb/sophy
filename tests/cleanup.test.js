const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanupSophyUiDirs } = require('./e2e/teardown');

test('a limpeza apaga as pastas sophy-ui deixadas pelos testes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-clean-'));
  fs.mkdirSync(path.join(dir, 'sophy-ui-data-teste'));
  fs.writeFileSync(path.join(dir, 'sophy-ui-data-teste', 'lock'), '1');
  fs.mkdirSync(path.join(dir, 'outra'));
  assert.equal(cleanupSophyUiDirs(dir), 1);
  assert.equal(fs.existsSync(path.join(dir, 'sophy-ui-data-teste')), false);
  assert.equal(fs.existsSync(path.join(dir, 'outra')), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
