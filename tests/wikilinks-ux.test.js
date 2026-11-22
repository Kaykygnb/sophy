const { test } = require('node:test');
const assert = require('node:assert/strict');
const Cmd = require('../src/ui/commands');

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
