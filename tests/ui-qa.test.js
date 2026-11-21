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
  assert.match(html, /class="cv-previa"/);
});

test('a prévia usa os estilos do editor e não deixa citação nem código crus', () => {
  const html = commands.notePreviewHtml(
    '**negrito** e *itálico*\n\n> uma citação\n\n```\nconst cru = true;\n```\n',
  );
  assert.match(html, /<strong>negrito<\/strong>/);
  assert.match(html, /<em>itálico<\/em>/);
  assert.match(html, /<blockquote class="bloco bloco--citacao">uma citação<\/blockquote>/);
  assert.match(html, /<pre class="bloco bloco--codigo"><code>const cru = true;<\/code><\/pre>/);
  assert.equal(html.includes('> uma'), false);
  assert.equal(html.includes('```'), false);
  assert.match(html, /cv-previa/);
});

test('o registro de comandos tem os atalhos da descoberta', () => {
  const byId = Object.fromEntries(commands.COMMANDS.map((item) => [item.id, item.atalho]));
  assert.equal(byId.estante, 'Ctrl+Shift+N');
  assert.equal(byId.biblioteca, 'Ctrl+Shift+O');
  assert.equal(byId.riscado, 'Ctrl+Shift+X');
  assert.equal(byId.destacar, 'Ctrl+Shift+H');
  assert.equal(byId.link, 'Ctrl+L');
  assert.equal(byId.tarefa, 'Ctrl+Enter');
  assert.equal(byId.hoje, 'Alt+D');
  assert.equal(byId.sofi, 'Ctrl+J');
  assert.equal(byId['novo-canvas'], '');
  assert.equal(commands.COMMANDS.some((item) => item.id === 'canvas'), false);
  assert.equal(commands.COMMANDS.find((item) => item.rotulo === 'Novo canvas').id, 'novo-canvas');
});

test('a árvore marca só o item ativo', () => {
  const both = { active: 'Estudos/Leitura.md', selectedShelf: 'Estudos', canvasPath: null };
  assert.equal(commands.treeMarked('note', 'Estudos/Leitura.md', both), true);
  assert.equal(commands.treeMarked('shelf', 'Estudos', both), false);
  const shelf = { ...both, treeFocus: 'shelf' };
  assert.equal(commands.treeMarked('shelf', 'Estudos', shelf), true);
  assert.equal(commands.treeMarked('note', 'Estudos/Leitura.md', shelf), false);
});

test('a capa resolve a coleção, a cor, o arquivo e a migração', () => {
  assert.equal(commands.resolveCover({ capa: 'sophy:ondas', capa_y: '40%' }).id, 'ondas');
  assert.equal(commands.resolveCover({ capa: 'sophy:ondas', capa_y: '40%' }).y, 0.4);
  assert.equal(commands.resolveCover({ capa: 'sophy:1' }).id, 'rede');
  assert.equal(commands.resolveCover({ ilustracao: 3 }).id, 'horizonte');
  assert.equal(commands.resolveCover({ capa: 'cor:estante' }).kind, 'cor');
  assert.equal(commands.resolveCover({ capa: 'cor:2' }).color, '2');
  assert.equal(commands.resolveCover({ capa: 'assets/foto.png' }).kind, 'arquivo');
  assert.equal(commands.resolveCover({ capa_y: '50%' }), null);
  assert.equal(commands.COVER_IDS.length, 24);
});

test('a estante conhecida tem ícone fixo e a nota fica no nível 2', () => {
  assert.equal(commands.shelfMark('Estudos').icon, 'graduation-cap');
  assert.equal(commands.shelfMark('Diário').icon, 'calendar-dot');
  assert.equal(commands.shelfMark('Leituras').icon, 'book');
  assert.equal(commands.shelfMark('Trabalho').icon, 'briefcase');
  assert.equal(commands.shelfMark('Pesquisa').icon, 'lightbulb');
  assert.equal(commands.shelfMark('Entrada').icon, 'tray');
  assert.equal(commands.shelfGlyph('capelo'), 'graduation-cap');
  assert.equal(commands.shelfGlyph('caixa-entrada'), 'tray');
  assert.equal(commands.shelfMark('Entrada').color, null);
  assert.equal(commands.noteIndent('Estudos/Nota.md'), 2);
  assert.equal(commands.noteIndent('Estudos/Sub/Nota.md'), 3);
});
