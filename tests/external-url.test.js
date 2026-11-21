const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chosenFilePaths, isSafeExternalUrl, OPEN_FILE_PROPERTIES } = require('../src/shell-policy');

test('openExternal aceita só http, https e mailto', () => {
  for (const url of [
    'http://example.com',
    'https://example.com/a?b=1',
    'HTTP://example.com',
    'Https://example.com/caminho',
    'mailto:ana@example.com',
    'mailto:',
    '  https://example.com  ',
  ])
    assert.equal(isSafeExternalUrl(url), true, url);

  for (const url of [
    'file:///etc/passwd',
    'file://localhost/tmp/nota.md',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,oi',
    '',
    '   ',
    'nota.md',
    'http://',
    '//example.com',
    'ftp://example.com',
    '/tmp/nota.md',
  ])
    assert.equal(isSafeExternalUrl(url), false, url);

  for (const value of [null, undefined, 1, {}, []])
    assert.equal(isSafeExternalUrl(value), false);
});

test('chooseFiles devolve a lista de caminhos e vazio ao cancelar', () => {
  assert.deepEqual(OPEN_FILE_PROPERTIES, ['openFile', 'multiSelections']);
  assert.deepEqual(chosenFilePaths({ canceled: true, filePaths: ['/tmp/a.png'] }), []);
  assert.deepEqual(chosenFilePaths({ canceled: false, filePaths: ['/tmp/a.png', '/tmp/b.png'] }), [
    '/tmp/a.png',
    '/tmp/b.png',
  ]);
  assert.deepEqual(chosenFilePaths(null), []);
  assert.deepEqual(chosenFilePaths({ canceled: false }), []);
  assert.deepEqual(chosenFilePaths({ canceled: false, filePaths: ['', '/tmp/a.png', 2] }), ['/tmp/a.png']);
});
