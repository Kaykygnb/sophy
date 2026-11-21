const { test } = require('node:test');
const assert = require('node:assert/strict');
const Cmd = require('../src/ui/commands');
const Links = require('../src/note-links');
const { rewriteDocument } = require('../src/link-rewrite');

test('busca aproximada: oper dom acha Operation Dominion', () => {
  assert.ok(Cmd.fuzzyScore('oper dom', 'Operation Dominion') > 0);
  assert.ok(Cmd.fuzzyScore('dominion ops', 'OD', 'Dominion Ops') > 0);
});

test('parseWikiDraft cobre seção, bloco e apelido', () => {
  assert.deepEqual(Cmd.parseWikiDraft('Nota#Seção|texto'), {
    note: 'Nota',
    anchor: 'Seção',
    alias: 'texto',
    hasPipe: true,
    hasHash: true,
  });
  assert.equal(Cmd.parseWikiDraft('Nota#^bloco').anchor, '^bloco');
});

test('wikiQuery aceita # e | enquanto digita', () => {
  assert.deepEqual(Cmd.wikiQuery('Veja [[Nota#Se', 14), { start: 5, query: 'Nota#Se' });
  assert.deepEqual(Cmd.wikiQuery('Veja [[Nota|te', 14), { start: 5, query: 'Nota|te' });
});

test('renomear com acento, apelido, seção e bloco preserva sintaxe', () => {
  const paths = ['Estudos/José.md', 'Estudos/Fonte.md'];
  const map = (p) => (p === 'Estudos/José.md' ? 'Arquivo/João.md' : p);
  const content = '[[José|o Zé]] [[José#Seção]] [[José#^bloco-1]]\n';
  const out = rewriteDocument(content, 'Estudos/Fonte.md', paths, map);
  assert.match(out, /\[\[Arquivo\/João\|o Zé\]\]/);
  assert.match(out, /\[\[Arquivo\/João#Seção\]\]/);
  assert.match(out, /\[\[Arquivo\/João#\^bloco-1\]\]/);
});

test('ambiguidade: link por nome não troca de alvo ao renomear a outra pasta', () => {
  const paths = ['Alpha/Nota.md', 'Beta/Nota.md', 'Alpha/Fonte.md'];
  const map = (p) => (p === 'Beta/Nota.md' ? 'Beta/Renomeada.md' : p);
  const content = 'Fica [[Nota]].\n';
  const out = rewriteDocument(content, 'Alpha/Fonte.md', paths, map);
  assert.equal(out, content);
});

test('código e inline code não são reescritos', () => {
  const paths = ['Alvo.md', 'Fonte.md'];
  const map = (p) => (p === 'Alvo.md' ? 'Novo.md' : p);
  const content = 'Fora [[Alvo]]\n\n`[[Alvo]]`\n\n```\n[[Alvo]]\n```\n';
  const out = rewriteDocument(content, 'Fonte.md', paths, map);
  assert.match(out, /Fora \[\[Novo\]\]/);
  assert.match(out, /`\[\[Alvo\]\]`/);
  assert.match(out, /```\n\[\[Alvo\]\]\n```/);
});

test('prévia e link escapam HTML/script', () => {
  const dirty = '[[<script>alert(1)</script>|x]]';
  const html = Links.anchor(dirty.slice(2, -2));
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;|&amp;lt;script/);
});
