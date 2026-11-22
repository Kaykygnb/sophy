const { test } = require('node:test');
const assert = require('node:assert/strict');
const writing = require('../src/ui/writing');
const doc = require('../src/ui/doc');

test('formatação aninhada e wikilink usam os elementos do design atual', () => {
  const html = writing.inlineHtml('**forte e *itálico*** [[Estudos/Nota|apelido]] ==realce==');
  assert.match(html, /<strong>forte e <em>itálico<\/em><\/strong>/);
  assert.match(html, /class="wikilink"/);
  assert.match(html, /data-raw="\[\[Estudos\/Nota\|apelido\]\]"/);
  assert.match(html, /<mark class="marca">realce<\/mark>/);
});

test('renderização permite sublinhado e mantém HTML ativo como texto', () => {
  const html = writing.inlineHtml(
    '<u>texto</u> <img src=x onerror=alert(1)> <script>alert(2)</script>',
  );
  assert.match(html, /<u>texto<\/u>/);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img/);
});

test('quebra suave continua no mesmo bloco após reabrir', () => {
  const document = doc.parseBody('primeira  \nsegunda\n');
  assert.equal(document.blocks.length, 1);
  assert.match(writing.inlineHtml(doc.visibleOf(document.blocks[0])), /primeira<br>segunda/);
  assert.equal(doc.serializeBlocks(document.blocks), 'primeira  \nsegunda\n');
});

test('nota vazia tem um ponto de escrita', () => {
  assert.equal(doc.parseBody('').blocks.length, 1);
  assert.equal(doc.parseBody('').blocks[0].type, 'paragraph');
});

test('numeração de lista respeita os níveis de recuo', () => {
  const document = doc.parseBody('1. Pai\n  2. Filho\n  3. Outro\n3. Proximo\n');
  assert.equal(
    doc.serializeBlocks(doc.renumberNumbered(document).blocks),
    '1. Pai\n  1. Filho\n  2. Outro\n2. Proximo\n',
  );
});

test('pipe de célula é escapado sem danificar aliases de wikilinks', () => {
  assert.equal(
    doc.tableRaw([['a | b', '[[Nota|apelido]]']], [':--', '--:']),
    '| a \\| b | [[Nota|apelido]] |\n| :-- | --: |\n',
  );
});
