const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { namedBlocksOf } = require('../engine/blocks.ts');
const { EngineError } = require('../engine/errors.ts');
const { headingsOf } = require('../engine/wikilinks.ts');
const { callTool } = require('../engine/tools.ts');

function fixture() {
  return { root: fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-blocos-js-')) };
}

function create(root, file, body) {
  return callTool('note.create', { libraryPath: root, path: file, body, origin: 'ui' });
}

test('cerca nomeada: title em qualquer posição, linguagem na primeira palavra', () => {
  const source = '```title="dados" python\nprint(1)\n```\n\n```js title="api"\nconst a = 1;\n```\n';
  assert.deepEqual(
    namedBlocksOf(source).map((block) => [block.lang, block.title]),
    [
      ['python', 'dados'],
      ['js', 'api'],
    ],
  );
  assert.equal(namedBlocksOf('```js title=\'nao\'\n1\n```\n').length, 0);
});

test('# dentro do bloco não é seção e o slug ignora acento e caixa', () => {
  const source = '# Real\n\n```js title="Ação"\n# Falso\n```\n';
  assert.deepEqual(headingsOf(source), ['Real']);
  const { root } = fixture();
  create(root, 'Estudos/Nota.md', source);
  create(root, 'Estudos/Fonte.md', '[[Nota#acao]]\n');
  const resolved = callTool('links.resolve', {
    libraryPath: root,
    path: 'Estudos/Fonte.md',
    target: 'Nota#ACAO',
  });
  assert.equal(resolved.kind, 'block');
  assert.equal(resolved.title, 'Ação');
  assert.equal(resolved.preview, '# Falso');
  assert.equal(resolved.truncated, false);
});

test('seção ganha, duplicata marca o segundo e alvo inexistente não ganha kind', () => {
  const { root } = fixture();
  create(root, 'Estudos/Nota.md', '# Api\n\n```js title="api"\num\n```\n\n```py title="api"\ndois\n```\n');
  create(root, 'Alpha/Nota.md', 'Outra.\n');
  create(root, 'Raiz.md', '[[Nota]]\n');
  create(root, 'Estudos/Fonte.md', '[[Nota#api]] [[Nota#ausente]]\n');
  const section = callTool('links.resolve', {
    libraryPath: root,
    path: 'Estudos/Fonte.md',
    target: '[[Nota#api]]',
  });
  assert.equal(section.kind, 'section');
  assert.equal(section.title, 'Api');
  const scanned = callTool('links.scan', { libraryPath: root, path: 'Estudos/Nota.md' });
  assert.equal(scanned.blocks[0].duplicate, undefined);
  assert.equal(scanned.blocks[1].duplicate, true);
  const missing = callTool('links.resolve', {
    libraryPath: root,
    path: 'Estudos/Fonte.md',
    target: 'Nota#ausente',
  });
  assert.equal(missing.path, null);
  assert.equal(missing.invalid, false);
  assert.equal(missing.kind, undefined);
  const ambiguous = callTool('links.resolve', { libraryPath: root, path: 'Raiz.md', target: 'Nota' });
  assert.equal(ambiguous.path, null);
  assert.equal(ambiguous.candidates.length, 2);
});

test('prévia do bloco é lang/title/code e a seção continua o trecho markdown', () => {
  const { root } = fixture();
  create(root, 'Estudos/Nota.md', '# Api\ntexto\n\n```js title="outro"\nreturn 1\n```\n');
  const section = callTool('links.preview', {
    libraryPath: root,
    path: 'Estudos/Nota.md',
    target: 'Nota#Api',
  });
  assert.equal(section.kind, 'section');
  assert.match(section.text, /# Api/);
  assert.match(section.text, /texto/);
  const block = callTool('links.preview', {
    libraryPath: root,
    path: 'Estudos/Nota.md',
    target: 'Nota#outro',
  });
  assert.deepEqual(block, { kind: 'block', lang: 'js', title: 'outro', code: 'return 1' });
});

test('resolve limita a prévia a 40 linhas', () => {
  const { root } = fixture();
  const lines = Array.from({ length: 41 }, (_, index) => 'l' + (index + 1));
  create(root, 'Nota.md', ['```js title="longa"', ...lines, '```', ''].join('\n'));
  const resolved = callTool('links.resolve', { libraryPath: root, path: 'Nota.md', target: 'Nota#longa' });
  assert.equal(resolved.kind, 'block');
  assert.equal(resolved.truncated, true);
  assert.equal(resolved.preview.split('\n').length, 40);
  assert.equal(resolved.preview.includes('l41'), false);
});

test('block.rename, nome_em_uso, desfazer e barra invertida', () => {
  const { root } = fixture();
  create(root, 'Estudos/Nota.md', '```js title="api"\nconst a = 1;\n```\n\n[[#api|local]]\n\n```\n[[#api]]\n```\n');
  create(root, 'Estudos/Fonte.md', '[[Nota#api|apelido]]\n');
  const before = fs.readFileSync(path.join(root, 'Estudos', 'Nota.md'), 'utf8');
  const fonteBefore = fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8');
  create(root, 'Estudos/Cheia.md', '# Pronto\n\n```js title="livre"\n1\n```\n');
  assert.throws(
    () =>
      callTool('block.rename', {
        libraryPath: root,
        notePath: 'Estudos/Cheia.md',
        de: 'livre',
        para: 'Pronto',
        origin: 'ui',
      }),
    (error) => error instanceof EngineError && error.code === 'nome_em_uso',
  );
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Cheia.md'), 'utf8'), /title="livre"/);
  callTool('block.rename', {
    libraryPath: root,
    notePath: 'Estudos\\Nota.md',
    de: 'api',
    para: 'codigo',
    origin: 'ui',
  });
  const note = fs.readFileSync(path.join(root, 'Estudos', 'Nota.md'), 'utf8');
  assert.match(note, /title="codigo"/);
  assert.match(note, /\[\[#codigo\|local\]\]/);
  assert.match(note, /```\n\[\[#api\]\]\n```/);
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8'), /\[\[Nota#codigo\|apelido\]\]/);
  const history = callTool('history.list', { libraryPath: root });
  assert.equal(history[0].tool, 'block.rename');
  callTool('history.undo', { libraryPath: root, origin: 'ui' });
  assert.equal(fs.readFileSync(path.join(root, 'Estudos', 'Nota.md'), 'utf8'), before);
  assert.equal(fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8'), fonteBefore);
});

test('mover a nota preserva #nome e o grafo anota o alvo sem nó novo', () => {
  const { root } = fixture();
  create(root, 'Estudos/Nota.md', '```js title="api"\n1\n```\n\n# Secao\n');
  create(root, 'Estudos/Fonte.md', '[[Nota#api]] e [[Nota#Secao]] e [[Nota]].\n');
  const graph = callTool('graph.query', { libraryPath: root, workspace: 'Estudos' });
  assert.deepEqual(
    graph.nodes.map((node) => node.path).sort(),
    ['Estudos/Fonte.md', 'Estudos/Nota.md'],
  );
  const edges = graph.edges.filter((edge) => edge.from === 'Estudos/Fonte.md');
  assert.equal(edges.length, 3);
  assert.deepEqual(edges.find((edge) => edge.target && edge.target.anchor === 'api').target, {
    kind: 'block',
    anchor: 'api',
  });
  assert.deepEqual(edges.find((edge) => !edge.target), {
    from: 'Estudos/Fonte.md',
    to: 'Estudos/Nota.md',
    format: 'wiki',
  });
  callTool('entry.move', {
    libraryPath: root,
    from: 'Estudos/Nota.md',
    to: 'Livro/Movida.md',
    origin: 'ui',
  });
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8'), /\[\[Livro\/Movida#api\]\]/);
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Fonte.md'), 'utf8'), /\[\[Livro\/Movida#Secao\]\]/);
});
