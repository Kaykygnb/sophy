'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { WorkspaceStore, contains } = require('./workspaces');
class WorldManager {
  constructor(file, options) {
    this.file = file;
    this.options = options;
    this.store = null;
    this.error = '';
    this.known = { version: 1, worlds: [], lastWorld: null };
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (
        data.version !== 1 ||
        !Array.isArray(data.worlds) ||
        data.worlds.some(
          (w) =>
            !w ||
            typeof w.id !== 'string' ||
            typeof w.path !== 'string' ||
            !path.isAbsolute(w.path) ||
            typeof w.name !== 'string',
        )
      )
        throw Error('Lista de mundos inválida. O cadastro foi preservado.');
      this.known = data;
    }
    if (this.known.lastWorld) {
      const w = this.known.worlds.find((w) => w.id === this.known.lastWorld);
      if (w)
        try {
          this.load(w.path, w.id);
        } catch (e) {
          this.error = `Não foi possível reabrir “${w.name}”: ${e.message}`;
        }
    }
  }
  saveKnown(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temp, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, this.file);
      this.known = data;
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  guard(folder) {
    const helper = new WorkspaceStore(
      path.join(path.dirname(this.file), '__path-validation-only__'),
      this.options,
    );
    const real = helper.safe(folder);
    for (const w of this.known.worlds)
      if (w.path !== real && (contains(w.path, real) || contains(real, w.path)))
        throw Error('Um mundo não pode ficar dentro de outro mundo conhecido.');
    return real;
  }
  inspect(folder) {
    const root = this.guard(folder),
      meta = path.join(root, '.notas1'),
      file = path.join(meta, 'world.json');
    if (!fs.existsSync(meta)) return { root, file, initialized: false };
    if (fs.lstatSync(meta).isSymbolicLink() || !fs.statSync(meta).isDirectory())
      throw Error('A pasta .notas1 não é válida.');
    if (!fs.existsSync(file))
      throw Error('A pasta .notas1 já existe, mas não contém um mundo válido. Nada foi alterado.');
    if (fs.lstatSync(file).isSymbolicLink())
      throw Error('O cadastro do mundo não pode ser um link simbólico.');
    return { root, file, initialized: true };
  }
  load(folder, expectedId) {
    const info = this.inspect(folder);
    if (!info.initialized) throw Error('Esta pasta ainda não é um mundo Sophy.');
    const store = new WorkspaceStore(info.file, { ...this.options, root: info.root });
    if (expectedId && store.world.id !== expectedId)
      throw Error('Esta pasta pertence a outro mundo. Use Carregar mundo para confirmá-la.');
    const known = this.known.worlds.find((w) => w.id === store.world.id);
    if (known && known.path !== info.root && fs.existsSync(known.path))
      throw Error(
        'Já existe um mundo com esse identificador em outra pasta disponível. Use a pasta original.',
      );
    const item = { ...store.world, path: info.root };
    this.saveKnown({
      ...this.known,
      lastWorld: item.id,
      worlds: [...this.known.worlds.filter((w) => w.id !== item.id), item],
    });
    this.store = store;
    this.error = '';
    return this.state();
  }
  initialize(name, folder) {
    const info = this.inspect(folder);
    if (info.initialized) return this.load(folder);
    name = typeof name === 'string' ? name.trim() : '';
    if (!name || name.length > 100) throw Error('Informe um nome de mundo de até 100 caracteres.');
    fs.mkdirSync(path.dirname(info.file));
    const world = { id: randomUUID(), name, createdAt: new Date().toISOString() };
    const store = new WorkspaceStore(info.file, { ...this.options, root: info.root, world });
    store.save([]);
    return this.load(info.root);
  }
  create(name, parent) {
    const helper = new WorkspaceStore(
      path.join(path.dirname(this.file), '__path-validation-only__'),
      this.options,
    );
    name = helper.name(name);
    if (/[\\/\x00-\x1f<>:"|?*]/.test(name) || name.startsWith('.') || /[. ]$/.test(name))
      throw Error('Use um nome de pasta válido, sem barras nem ponto inicial.');
    parent = helper.canonical(parent);
    const root = path.join(parent, name);
    if (fs.existsSync(root))
      throw Error('Já existe uma pasta com esse nome. Use Carregar mundo para escolhê-la.');
    fs.mkdirSync(root);
    try {
      return this.initialize(name, root);
    } catch (e) {
      try {
        fs.rmdirSync(root);
      } catch {}
      throw e;
    }
  }
  current() {
    if (!this.store) throw Error('Carregue um mundo primeiro.');
    this.store.assertRoot();
    return this.store;
  }
  state() {
    let world = null,
      workspaces = [];
    if (this.store) {
      world = { ...this.store.world, path: this.store.root };
      try {
        workspaces = this.store.list();
      } catch (e) {
        this.error = `Mundo indisponível: ${e.message}`;
        world.available = false;
      }
    }
    return {
      world,
      workspaces,
      worlds: this.known.worlds.map((w) => ({ ...w, available: fs.existsSync(w.path) })),
      error: this.error,
    };
  }
}
module.exports = { WorldManager };
