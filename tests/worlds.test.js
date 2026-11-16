const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorldManager } = require('../src/worlds');
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'notas1-world-'));
  const home = path.join(base, 'home');
  fs.mkdirSync(home);
  const data = path.join(home, '.app');
  fs.mkdirSync(data);
  const file = path.join(data, 'worlds.json'),
    options = { home, protectedPaths: [data] };
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { home, file, options, manager: new WorldManager(file, options) };
}
test('mundo cria áreas apenas dentro da raiz e ignora pastas não cadastradas', (t) => {
  const { home, manager } = fixture(t);
  manager.create('Universo', home);
  const root = manager.current().root;
  fs.mkdirSync(path.join(root, 'Por fora'));
  assert.equal(manager.state().workspaces.length, 0);
  const area = manager.current().create('Estudos', home).workspace;
  assert.equal(area.path, path.join(root, 'Estudos'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.notas1', 'world.json')));
  assert.equal(manifest.workspaces[0].folder, 'Estudos');
  assert.equal(manifest.workspaces[0].path, undefined);
  assert.throws(() => manager.current().register('Externa', home));
  assert.throws(() => manager.current().register('Interna', path.join(root, '.notas1')));
  assert.throws(() => manager.current().create('.notas1'));
  manager.current().register('Adotada', path.join(root, 'Por fora'));
  assert.equal(manager.state().workspaces.length, 2);
});
test('trocar mundos isola as áreas e reabre último mundo sem abrir área', (t) => {
  const { home, manager, file, options } = fixture(t);
  manager.create('Primeiro', home);
  const one = manager.state().world;
  const a = manager.current().create('A').workspace;
  manager.current().open(a.id);
  manager.create('Segundo', home);
  assert.equal(manager.state().workspaces.length, 0);
  const two = manager.state().world;
  manager.current().create('B');
  manager.load(one.path);
  assert.equal(manager.state().workspaces[0].name, 'A');
  manager.load(two.path);
  const restored = new WorldManager(file, options);
  assert.equal(restored.state().world.id, two.id);
  assert.equal(restored.state().workspaces[0].name, 'B');
  assert.equal(restored.state().workspaces[0].lastAccessAt, null);
});
test('mover mundo preserva ID e resolve caminhos relativos', (t) => {
  const { home, manager, file, options } = fixture(t);
  manager.create('Original', home);
  const world = manager.state().world,
    area = manager.current().create('Área').workspace;
  fs.writeFileSync(path.join(area.path, 'nota'), 'preservar');
  const moved = path.join(home, 'Movido');
  fs.renameSync(world.path, moved);
  const restored = new WorldManager(file, options);
  assert.equal(restored.state().world, null);
  assert.ok(restored.state().error);
  restored.load(moved);
  assert.equal(restored.state().world.id, world.id);
  assert.equal(restored.state().workspaces[0].id, area.id);
  assert.equal(restored.state().workspaces[0].path, path.join(moved, 'Área'));
  restored.current().delete(area.id, restored.current().deletionSnapshot(area.id));
  assert.ok(fs.existsSync(path.join(moved, '.notas1', 'world.json')));
});
test('metadados inválidos e caminhos fora do mundo são rejeitados sem apagar dados', (t) => {
  const { home, manager } = fixture(t);
  manager.create('Mundo', home);
  const root = manager.current().root,
    manifestPath = path.join(root, '.notas1', 'world.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.workspaces.push({
    id: 'bad',
    name: 'escape',
    folder: '../outra',
    createdAt: new Date().toISOString(),
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => manager.load(root), /inválida/);
  assert.ok(fs.existsSync(manifestPath));
});
test('excluir área preserva o mundo e suas outras subpastas', (t) => {
  const { home, manager } = fixture(t);
  manager.create('Mundo', home);
  const store = manager.current(),
    a = store.create('A').workspace,
    b = store.create('B').workspace;
  fs.writeFileSync(path.join(b.path, 'arquivo'), 'preservar');
  store.delete(a.id, store.deletionSnapshot(a.id));
  assert.equal(fs.existsSync(a.path), false);
  assert.ok(fs.existsSync(path.join(b.path, 'arquivo')));
  assert.equal(manager.state().workspaces.length, 1);
  assert.throws(() => store.relocate(b.id, store.root));
});
