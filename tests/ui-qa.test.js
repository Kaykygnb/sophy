const { test } = require('node:test');
const assert = require('node:assert/strict');
const commands = require('../src/ui/commands');

test('o status da tarefa vira a classe do kit, sem ícone extra', () => {
  assert.equal(commands.kitTaskStatus(' '), 'aberta');
  assert.equal(commands.kitTaskStatus('/'), 'andamento');
  assert.equal(commands.kitTaskStatus('x'), 'feita');
  assert.equal(commands.kitTaskStatus('-'), 'cancelada');
  assert.equal(commands.taskBlockClass('x'), 'tarefa tarefa--feita');
  assert.equal(commands.taskBlockClass('-'), 'tarefa tarefa--cancelada');
  assert.equal(commands.taskBlockClass('/'), 'tarefa');
  assert.equal(commands.taskBlockClass(' ').includes('tarefa'), true);
  assert.equal(commands.taskBlockClass('x').includes('i-tarefa'), false);
});

test('Sem título ganha um número quando o nome já existe', () => {
  assert.equal(commands.uniqueTitle([]), 'Sem título');
  assert.equal(commands.uniqueTitle(['Sem título']), 'Sem título 2');
  assert.equal(commands.uniqueTitle(['Sem título', 'Sem título 2']), 'Sem título 3');
});

test('a prévia do cartão não mostra o Markdown cru da tarefa', () => {
  const html = commands.notePreviewHtml(
    '# Título\n\nA memória se liga a [[Estudos/Grafo|o grafo]].\n- [ ] abrir 📅 2026-11-20 ⏫\n- [x] lido\n',
  );
  assert.match(html, /data-status="aberta"/);
  assert.match(html, /data-status="feita"/);
  assert.match(html, /class="wikilink"/);
  assert.match(html, /o grafo/);
  assert.match(html, /2026-11-20/);
  assert.match(html, /Alta/);
  assert.equal(html.includes('- [ ]'), false);
  assert.equal(html.includes('[['), false);
  assert.equal(html.includes('📅'), false);
  assert.equal(html.includes('⏫'), false);
});

test('a árvore marca só o item ativo', () => {
  const both = { active: 'Estudos/Leitura.md', selectedShelf: 'Estudos', canvasPath: null };
  assert.equal(commands.treeMarked('note', 'Estudos/Leitura.md', both), true);
  assert.equal(commands.treeMarked('shelf', 'Estudos', both), false);
  const shelf = { ...both, treeFocus: 'shelf' };
  assert.equal(commands.treeMarked('shelf', 'Estudos', shelf), true);
  assert.equal(commands.treeMarked('note', 'Estudos/Leitura.md', shelf), false);
});

test('a estante conhecida tem ícone fixo e a nota fica no nível 2', () => {
  assert.equal(commands.shelfMark('Estudos').icon, 'capelo');
  assert.equal(commands.shelfMark('Diário').icon, 'nota-diaria');
  assert.equal(commands.shelfMark('Leituras').icon, 'livro');
  assert.equal(commands.shelfMark('Trabalho').icon, 'maleta');
  assert.equal(commands.shelfMark('Pesquisa').icon, 'lampada');
  assert.equal(commands.shelfMark('Entrada').icon, 'caixa-entrada');
  assert.equal(commands.shelfMark('Entrada').color, null);
  assert.equal(commands.noteIndent('Estudos/Nota.md'), 2);
  assert.equal(commands.noteIndent('Estudos/Sub/Nota.md'), 3);
});
