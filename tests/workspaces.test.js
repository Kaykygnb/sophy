const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceStore } = require('../src/workspaces');
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'notas1-test-'));
  const home = path.join(base, 'home'),
    data = path.join(home, '.app');
  fs.mkdirSync(home);
  fs.mkdirSync(data);
  const file = path.join(data, 'workspaces.json');
  const store = new WorkspaceStore(file, { home, protectedPaths: [data] });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, home, data, file, store };
}
test('criar, persistir, abrir e renomear sem alterar a pasta', (t) => {
  const { home, file, data, store } = fixture(t);
  const w = store.create('Estudos', home).workspace;
  assert.ok(fs.statSync(w.path).isDirectory());
  assert.equal(w.lastAccessAt, null);
  store.rename(w.id, 'Meu apelido');
  assert.ok(fs.existsSync(path.join(home, 'Estudos')));
  assert.equal(store.open(w.id).name, 'Meu apelido');
  const restored = new WorkspaceStore(file, { home, protectedPaths: [data] });
  assert.equal(restored.list()[0].id, w.id);
  assert.ok(restored.list()[0].lastAccessAt);
  assert.equal(restored.create('Estudos', home).exists, true);
});
test('duplicatas, sobreposição, caminhos críticos e links são bloqueados', (t) => {
  const { home, data, store } = fixture(t);
  const w = store.create('Projeto', home).workspace;
  assert.throws(() => store.register('Duplicada', w.path), /sobrepõe/);
  const sub = path.join(w.path, 'sub');
  fs.mkdirSync(sub);
  assert.throws(() => store.register('Filha', sub), /sobrepõe/);
  assert.throws(() => store.register('Home', home), /protegida/);
  assert.throws(() => store.register('App', data), /protegida/);
  assert.throws(() => store.create('../escape', home), /nome de pasta/);
  const link = path.join(home, 'link');
  fs.symlinkSync(w.path, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => store.register('Link', link), /simbólico/);
  const throughLink = path.join(link, 'sub');
  assert.throws(() => store.register('Link indireto', throughLink), /simbólico/);
});
test('exclusão apaga só a pasta registrada e não segue links internos', (t) => {
  const { home, store, file } = fixture(t);
  const w = store.create('Descartável', home).workspace;
  const external = path.join(home, 'preservar');
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, 'arquivo'), 'seguro');
  fs.writeFileSync(path.join(w.path, 'nota'), 'excluir');
  fs.symlinkSync(
    external,
    path.join(w.path, 'link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  store.delete(w.id, store.deletionSnapshot(w.id));
  assert.equal(fs.existsSync(w.path), false);
  assert.equal(fs.readFileSync(path.join(external, 'arquivo'), 'utf8'), 'seguro');
  assert.equal(store.list().length, 0);
  assert.ok(fs.existsSync(file));
});
test('troca de pasta durante confirmação cancela exclusão', (t) => {
  const { home, store } = fixture(t);
  const w = store.create('Original', home).workspace,
    snapshot = store.deletionSnapshot(w.id);
  fs.renameSync(w.path, path.join(home, 'Movida'));
  fs.mkdirSync(w.path);
  fs.writeFileSync(path.join(w.path, 'nao-apagar'), 'x');
  assert.throws(() => store.delete(w.id, snapshot));
  assert.ok(fs.existsSync(path.join(w.path, 'nao-apagar')));
  assert.equal(store.list()[0].available, false);
});
test('pasta indisponível pode ser localizada sem perder ID nem dados', (t) => {
  const { home, store } = fixture(t);
  const w = store.create('Área', home).workspace;
  fs.writeFileSync(path.join(w.path, 'nota'), 'conteúdo');
  const moved = path.join(home, 'Novo local');
  fs.renameSync(w.path, moved);
  assert.equal(store.list()[0].available, false);
  assert.throws(() => store.open(w.id));
  store.relocate(w.id, moved);
  assert.equal(store.list()[0].id, w.id);
  assert.equal(store.list()[0].name, 'Área');
  assert.equal(store.list()[0].available, true);
  assert.throws(() => store.forget(w.id), /disponível/);
  fs.renameSync(moved, path.join(home, 'Offline'));
  store.forget(w.id);
  assert.equal(store.list().length, 0);
  assert.ok(fs.existsSync(path.join(home, 'Offline', 'nota')));
});
test('cadastro corrompido é preservado e não sobrescrito', (t) => {
  const { file, home } = fixture(t);
  fs.writeFileSync(file, 'quebrado');
  assert.throws(() => new WorkspaceStore(file, { home }));
  assert.equal(fs.readFileSync(file, 'utf8'), 'quebrado');
});
