const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorldManager } = require('../src/worlds');
const { AreaFiles } = require('../src/files');
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notas1-files-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const manager = new WorldManager(path.join(home, '.app', 'worlds.json'), {
    home,
    protectedPaths: [path.join(home, '.app')],
  });
  manager.create('Mundo', home);
  const area = manager.current().create('Área').workspace;
  const files = new AreaFiles(manager.current(), area.id);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { files, area, home, manager };
}
test('criar, listar, ler e salvar Markdown real com revisão', (t) => {
  const { files, area } = setup(t);
  files.create('', 'Pasta', 'directory');
  files.create('Pasta', 'Ideia', 'file');
  let note = files.read('Pasta/Ideia.md');
  const saved = files.write(note.path, '# Olá\n\n**Mundo**\n', note.revision);
  assert.equal(fs.readFileSync(path.join(area.path, note.path), 'utf8'), saved.content);
  assert.equal(files.tree()[0].children[0].name, 'Ideia.md');
  assert.notEqual(saved.revision, note.revision);
});
test('edição externa não é sobrescrita e criar nunca substitui arquivo', (t) => {
  const { files, area } = setup(t);
  files.create('', 'Nota', 'file', 'original');
  const note = files.read('Nota.md');
  fs.writeFileSync(path.join(area.path, 'Nota.md'), 'edição externa');
  const result = files.write('Nota.md', 'edição local', note.revision);
  assert.equal(result.conflict, true);
  assert.equal(files.read('Nota.md').content, 'edição externa');
  assert.throws(() => files.create('', 'Nota.md', 'file', 'apagar'));
});
test('renomear e mover preservam conteúdo; pastas não podem entrar nelas mesmas', (t) => {
  const { files } = setup(t);
  files.create('', 'A', 'directory');
  files.create('', 'B', 'directory');
  files.create('A', 'Nota', 'file', 'conteúdo');
  files.move('A/Nota.md', 'B/Novo.md');
  assert.equal(files.read('B/Novo.md').content, 'conteúdo');
  assert.throws(() => files.move('B', 'B/sub'));
});
test('raiz, metadados, traversal e links externos são bloqueados', (t) => {
  const { files, area, home } = setup(t);
  fs.symlinkSync(
    home,
    path.join(area.path, 'link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  for (const p of [
    '',
    '../fora.md',
    '/tmp/fora.md',
    '.notas1/world.json',
    'link/arquivo.md',
    'a/../b',
  ])
    assert.throws(() => files.resolve(p));
  assert.deepEqual(
    files.tree().map((entry) => entry.path),
    ['Anexos'],
  );
  assert.throws(() => files.create('', '../escape', 'file'));
});
test('lixeira recebe só o item validado e não faz exclusão permanente', async (t) => {
  const { files, area } = setup(t);
  files.create('', 'Nota', 'file', 'seguro');
  const snap = files.trashSnapshot('Nota.md');
  let called = null;
  await files.trash('Nota.md', snap, async (full) => {
    called = full;
  });
  assert.equal(called, path.join(area.path, 'Nota.md'));
  assert.equal(files.read('Nota.md').content, 'seguro');
  fs.renameSync(path.join(area.path, 'Nota.md'), path.join(area.path, 'Outra.md'));
  files.create('', 'Nota', 'file');
  await assert.rejects(() =>
    files.trash('Nota.md', snap, async () => assert.fail('não deveria enviar à lixeira')),
  );
});
test('índice de links e criação de destino ficam dentro da área', (t) => {
  const { files, area } = setup(t);
  files.create('', 'Origem', 'file', '[[Pesquisa/Alvo#Detalhes|alias]]\n');
  files.createLinked('Pesquisa/Alvo.md');
  let doc = files.read('Pesquisa/Alvo.md');
  files.write(doc.path, '# Detalhes\n', doc.revision);
  const index = files.linkIndex();
  assert.equal(index.notes.length, 2);
  assert.equal(
    index.notes.find((n) => n.path === 'Origem.md').links[0].target,
    'Pesquisa/Alvo#Detalhes',
  );
  assert.equal(index.notes.find((n) => n.path === 'Pesquisa/Alvo.md').headings[0].text, 'Detalhes');
  assert.throws(() => files.createLinked('../fora.md'));
  assert.equal(fs.existsSync(path.join(area.path, 'Pesquisa', 'Alvo.md')), true);
});
test('mover nota atualiza referências no Markdown sem sobrescrever arquivos', (t) => {
  const { files } = setup(t);
  files.create('', 'Origem', 'file', '[[Alvo|apelido]]\n');
  files.create('', 'Alvo', 'file', '# Alvo\n');
  const result = files.moveWithLinks('Alvo.md', 'Novo.md');
  assert.equal(files.read('Origem.md').content, '[[Novo|apelido]]\n');
  assert.equal(files.read('Novo.md').content, '# Alvo\n');
  assert.equal(result.updated.length, 1);
  assert.deepEqual(result.warnings, []);
});
test('busca full-text e grafo de links da área', (t) => {
  const { files } = setup(t);
  files.create('', 'Alpha', 'file', 'texto com palavra-chave especial\n');
  files.create('', 'Beta', 'file', '[[Alpha]] e menção comum\n![[Alpha]]\n');
  const search = files.searchNotes('palavra-chave');
  assert.equal(search.matches.length, 1);
  assert.equal(search.matches[0].path, 'Alpha.md');
  assert.match(search.matches[0].excerpt, /palavra-chave/);
  const graph = files.noteGraph();
  assert.equal(graph.notes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.deepEqual(graph.edges[0], { from: 'Beta.md', to: 'Alpha.md' });
});
test('canvas .canvas persiste nós e arestas com revisão', (t) => {
  const { files, area } = setup(t);
  files.create('', 'Mapa.canvas', 'file', JSON.stringify({ nodes: [], edges: [] }));
  const opened = files.readCanvas('Mapa.canvas');
  assert.equal(opened.data.nodes.length, 0);
  const next = {
    nodes: [
      { id: 'a1', type: 'text', x: 10, y: 20, width: 200, height: 120, text: 'Ideia' },
      { id: 'b2', type: 'file', x: 260, y: 40, width: 220, height: 100, file: 'Nota.md' },
    ],
    edges: [{ id: 'e1', fromNode: 'a1', toNode: 'b2', fromSide: 'right', toSide: 'left' }],
  };
  const saved = files.writeCanvas('Mapa.canvas', next, opened.revision);
  assert.equal(saved.data.nodes.length, 2);
  assert.equal(saved.data.edges.length, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(area.path, 'Mapa.canvas'), 'utf8')).nodes[0].text,
    'Ideia',
  );
  const conflict = files.writeCanvas('Mapa.canvas', next, opened.revision);
  assert.equal(conflict.conflict, true);
});
