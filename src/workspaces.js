'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const contains = (parent, child) => {
  const r = path.relative(parent, child);
  return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r));
};
class WorkspaceStore {
  constructor(file, { home, protectedPaths = [], root = null, world = null }) {
    this.file = file;
    this.root = root ? fs.realpathSync(root) : null;
    this.world = world;
    if (this.root) {
      const st = fs.statSync(this.root);
      this.rootIdentity = { dev: st.dev, ino: st.ino };
    }
    this.home = fs.realpathSync(home);
    this.protectedPaths = protectedPaths.map((p) => path.resolve(p));
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.version !== (this.root ? 2 : 1) || !Array.isArray(data.workspaces))
        throw Error('Cadastro de áreas inválido. O arquivo foi preservado.');
      if (this.root) {
        if (!data.world || typeof data.world.id !== 'string' || typeof data.world.name !== 'string')
          throw Error('Mundo inválido.');
        this.world = data.world;
        for (const w of data.workspaces) {
          if (
            typeof w.folder !== 'string' ||
            !w.folder ||
            w.folder === '.notas1' ||
            w.folder.startsWith('.') ||
            w.folder.includes('/') ||
            w.folder.includes('\\') ||
            w.folder === '..'
          )
            throw Error('Pasta de área inválida no cadastro.');
          w.path = path.join(this.root, w.folder);
          try {
            const st = fs.lstatSync(w.path);
            w.identity = { dev: String(st.dev), ino: String(st.ino) };
          } catch {
            delete w.identity;
          }
        }
      }
      const ids = new Set();
      for (const w of data.workspaces) {
        if (
          !w ||
          typeof w.id !== 'string' ||
          ids.has(w.id) ||
          typeof w.name !== 'string' ||
          typeof w.path !== 'string' ||
          !path.isAbsolute(w.path) ||
          !Number.isFinite(Date.parse(w.createdAt))
        )
          throw Error('Cadastro de áreas inválido. O arquivo foi preservado.');
        ids.add(w.id);
      }
      this.items = data.workspaces;
    } else this.items = [];
  }
  assertRoot() {
    if (!this.root) return;
    if (this.canonical(this.root) !== this.root)
      throw Error('A pasta do mundo mudou. Carregue o mundo novamente.');
    const st = fs.statSync(this.root);
    if (st.dev !== this.rootIdentity.dev || st.ino !== this.rootIdentity.ino)
      throw Error('A pasta do mundo foi substituída. Carregue o mundo novamente.');
    const meta = path.dirname(this.file);
    if (this.canonical(meta) !== meta) throw Error('A pasta interna do mundo foi alterada.');
    if (fs.existsSync(this.file) && fs.lstatSync(this.file).isSymbolicLink())
      throw Error('O cadastro não pode ser um link simbólico.');
  }
  save(next) {
    this.assertRoot();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(
        temp,
        JSON.stringify(
          this.root
            ? {
                version: 2,
                world: this.world,
                workspaces: next.map(({ path: fullPath, identity, ...w }) => ({
                  ...w,
                  folder: path.basename(fullPath),
                })),
              }
            : { version: 1, workspaces: next },
          null,
          2,
        ),
        { mode: 0o600, flag: 'wx' },
      );
      // O Windows exige permissão de escrita para sincronizar o arquivo.
      const fd = fs.openSync(temp, 'r+');
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, this.file);
      this.items = next;
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  get(id) {
    const w = this.items.find((w) => w.id === id);
    if (!w) throw Error('Área não encontrada.');
    return w;
  }
  name(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 100)
      throw Error('Informe um nome de até 100 caracteres.');
    return value.trim();
  }
  canonical(folder) {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw Error('Caminho inválido.');
    const normalized = path.resolve(folder);
    if (fs.lstatSync(normalized).isSymbolicLink())
      throw Error('Escolha uma pasta real, sem link simbólico.');
    const real = fs.realpathSync(normalized);
    if (real !== normalized)
      throw Error('O caminho contém um link simbólico. Escolha o caminho real.');
    if (!fs.statSync(real).isDirectory()) throw Error('O caminho não é uma pasta.');
    return real;
  }
  safe(folder, exceptId) {
    this.assertRoot();
    const real = this.canonical(folder);
    if (this.root && (path.dirname(real) !== this.root || path.basename(real).startsWith('.')))
      throw Error('A área deve ser uma subpasta direta e visível do mundo atual.');
    if (
      contains(real, this.home) ||
      contains(real, process.cwd()) ||
      this.protectedPaths.some((p) => contains(real, p) || contains(p, real))
    )
      throw Error('Essa pasta é protegida. Escolha uma pasta dedicada à área.');
    // Rejeita diretórios do sistema, mas permite pastas de trabalho dentro da pasta pessoal.
    const externalRoots =
      process.platform === 'linux'
        ? ['/media', '/mnt', '/run/media']
        : process.platform === 'darwin'
          ? ['/Volumes']
          : [];
    if (
      !contains(this.home, real) &&
      !externalRoots.some(
        (root) => contains(root, real) && path.relative(root, real).split(path.sep).length >= 2,
      )
    )
      throw Error('Escolha uma pasta dedicada na sua pasta pessoal ou em uma unidade externa.');
    for (const w of this.items)
      if (w.id !== exceptId && (contains(w.path, real) || contains(real, w.path)))
        throw Error('Essa pasta já é uma área ou se sobrepõe a outra área cadastrada.');
    return real;
  }
  list() {
    this.assertRoot();
    return this.items.map((w) => {
      let available = false,
        reason = '';
      try {
        const real = this.canonical(w.path),
          st = fs.statSync(real);
        if (w.identity && (String(st.dev) !== w.identity.dev || String(st.ino) !== w.identity.ino))
          throw Error('A pasta foi substituída. Localize e confirme a pasta novamente.');
        fs.accessSync(real, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
        available = true;
      } catch (e) {
        reason = e.code === 'ENOENT' ? 'Pasta não encontrada ou desconectada.' : e.message;
      }
      const { identity, ...publicFields } = w;
      return { ...publicFields, available, reason };
    });
  }
  register(name, folder) {
    const real = this.safe(folder),
      st = fs.statSync(real);
    const w = {
      id: randomUUID(),
      name: this.name(name),
      path: real,
      createdAt: new Date().toISOString(),
      lastAccessAt: null,
      identity: { dev: String(st.dev), ino: String(st.ino) },
    };
    fs.accessSync(real, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    this.save([...this.items, w]);
    return w;
  }
  create(name, parent) {
    this.assertRoot();
    if (this.root) parent = this.root;
    name = this.name(name);
    if (
      /[\\/\x00-\x1f<>:"|?*]/.test(name) ||
      name.startsWith('.') ||
      name === '..' ||
      /[. ]$/.test(name)
    )
      throw Error('Use um nome de pasta sem barras ou caracteres especiais.');
    const folder = path.join(this.canonical(parent), name);
    // Nunca reutiliza nem sobrescreve uma pasta existente.
    if (fs.existsSync(folder)) return { exists: true, path: folder };
    fs.mkdirSync(folder);
    try {
      return { workspace: this.register(name, folder) };
    } catch (e) {
      fs.rmdirSync(folder);
      throw e;
    }
  }
  rename(id, name) {
    this.get(id);
    name = this.name(name);
    this.save(this.items.map((w) => (w.id === id ? { ...w, name } : w)));
  }
  relocate(id, folder) {
    this.get(id);
    const real = this.safe(folder, id),
      st = fs.statSync(real);
    fs.accessSync(real, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    this.save(
      this.items.map((w) =>
        w.id === id
          ? { ...w, path: real, identity: { dev: String(st.dev), ino: String(st.ino) } }
          : w,
      ),
    );
  }
  open(id) {
    const status = this.list().find((w) => w.id === id);
    if (!status?.available) throw Error(status?.reason || 'Área indisponível.');
    const now = new Date().toISOString();
    this.save(this.items.map((w) => (w.id === id ? { ...w, lastAccessAt: now } : w)));
    return this.list().find((w) => w.id === id);
  }
  deletionSnapshot(id) {
    const w = this.get(id);
    this.safe(w.path, id);
    if (!this.list().find((x) => x.id === id).available)
      throw Error('Área indisponível. Localize a pasta ou remova apenas o cadastro.');
    const st = fs.statSync(w.path);
    return { id, path: w.path, dev: st.dev, ino: st.ino };
  }
  delete(id, snapshot) {
    const current = this.deletionSnapshot(id);
    if (
      !snapshot ||
      current.id !== snapshot.id ||
      current.path !== snapshot.path ||
      current.dev !== snapshot.dev ||
      current.ino !== snapshot.ino
    )
      throw Error('A pasta mudou durante a confirmação. Operação cancelada.');
    fs.rmSync(current.path, { recursive: true, force: false });
    this.save(this.items.filter((w) => w.id !== id));
  }
  forget(id) {
    this.get(id);
    if (this.list().find((w) => w.id === id).available)
      throw Error('A pasta está disponível. Use a ação de excluir a área.');
    this.save(this.items.filter((w) => w.id !== id));
  }
}
module.exports = { WorkspaceStore, contains };
