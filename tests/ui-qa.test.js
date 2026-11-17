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
