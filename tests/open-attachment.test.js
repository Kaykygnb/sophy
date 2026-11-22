const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('preload abre o anexo e o main prende o caminho à biblioteca', () => {
  const preload = fs.readFileSync('src/preload.js', 'utf8');
  const main = fs.readFileSync('src/main.js', 'utf8');
  assert.match(
    preload,
    /openAttachment:\s*\(path\)\s*=>\s*ipcRenderer\.invoke\('sophy:open-attachment',\s*path\)/,
  );
  assert.match(main, /handle\('sophy:open-attachment'/);
  assert.match(main, /resolveAttachmentPath/);
  assert.match(main, /shell\.openPath/);
  assert.match(main, /Nenhuma biblioteca aberta/);
  assert.match(
    preload,
    /exportMarkdown:\s*\(result\)\s*=>\s*ipcRenderer\.invoke\('sophy:export-markdown',\s*result\)/,
  );
  assert.match(main, /ipcMain\.handle\('sophy:export-markdown'/);
  assert.match(main, /planMarkdownExport/);
  assert.match(main, /showMessageBox/);
  assert.match(main, /Manter os dois/);
});
