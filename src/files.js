'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { contains } = require('./workspaces');
const { rewriteDocument } = require('./link-rewrite');
const NoteLinks = require('./note-links');
const linkCache = new Map();
const revision = (text) => createHash('sha256').update(text).digest('hex');
function pageMetadata(content) {
  const match = content.match(/^notas1_editor:\s*(\{[^\n]*\})\s*$/m);
  if (!match) return '';
  try {
    const icon = JSON.parse(match[1])?.metadata?.icon;
    return typeof icon === 'string' && icon.length <= 48 ? icon : '';
  } catch {
    return '';
  }
}
class AreaFiles {
  constructor(store, id) {
    this.store = store;
    this.id = id;
  }
  root() {
    const w = this.store.list().find((w) => w.id === this.id);
    if (!w?.available) throw Error('Área indisponível.');
    return w.path;
  }
  resolve(relative = '', { allowRoot = false, missing = false } = {}) {
    const root = this.root();
    if (
      typeof relative !== 'string' ||
      path.isAbsolute(relative) ||
      relative.includes('\\') ||
      relative.includes('\0')
    )
      throw Error('Caminho inválido.');
    const parts = relative ? relative.split('/') : [];
    if (
      parts.some(
        (p) =>
          !p ||
          p === '.' ||
          p === '..' ||
          p.startsWith('.') ||
          /[\x00-\x1f<>:"|?*]/.test(p) ||
          /[. ]$/.test(p),
      )
    )
      throw Error('Caminho inválido ou reservado.');
    if (!parts.length && !allowRoot) throw Error('A raiz da área não pode ser alterada.');
    let target = root;
    for (let i = 0; i < parts.length; i++) {
      target = path.join(target, parts[i]);
      if (missing && i === parts.length - 1 && !fs.existsSync(target)) break;
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw Error('Links simbólicos não são permitidos.');
      if (i < parts.length - 1 && !stat.isDirectory()) throw Error('Pasta inválida.');
    }
    if (!contains(root, target)) throw Error('O caminho está fora da área.');
    return target;
  }
  ensureAttachmentsFolder() {
    const folder = this.resolve('Anexos', { missing: true });
    if (!fs.existsSync(folder)) fs.mkdirSync(folder);
    else if (!fs.statSync(folder).isDirectory()) throw Error('“Anexos” precisa ser uma pasta.');
    return folder;
  }
  tree() {
    this.ensureAttachmentsFolder();
    const root = this.resolve('', { allowRoot: true });
    let count = 0;
    const walk = (dir, prefix = '', depth = 0) => {
      if (depth > 40) throw Error('A árvore ultrapassou o limite de 40 níveis.');
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter(
          (e) => !e.name.startsWith('.') && !e.isSymbolicLink() && (e.isDirectory() || e.isFile()),
        )
        .sort((a, b) => {
          const aAttachments =
            !prefix && a.isDirectory() && a.name.toLocaleLowerCase() === 'anexos';
          const bAttachments =
            !prefix && b.isDirectory() && b.name.toLocaleLowerCase() === 'anexos';
          return (
            Number(aAttachments) - Number(bAttachments) ||
            Number(b.isDirectory()) - Number(a.isDirectory()) ||
            a.name.localeCompare(b.name, 'pt-BR', { numeric: true })
          );
        })
        .map((e) => {
          if (++count > 20000) throw Error('A área ultrapassou o limite de 20 mil itens.');
          const relative = prefix + e.name,
            full = this.resolve(relative),
            stat = fs.lstatSync(full);
          return {
            name: e.name,
            path: relative,
            kind: stat.isDirectory() ? 'directory' : 'file',
            size: stat.size,
            modifiedAt: stat.mtimeMs,
            children: stat.isDirectory() ? walk(full, relative + '/', depth + 1) : undefined,
          };
        });
    };
    return walk(root);
  }
  read(relative) {
    if (!/\.md$/i.test(relative)) throw Error('Somente arquivos Markdown podem ser editados.');
    const full = this.resolve(relative),
      stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
      throw Error('A nota deve ser um arquivo de até 8 MB.');
    const content = fs.readFileSync(full, 'utf8');
    return { path: relative, content, revision: revision(content), modifiedAt: stat.mtimeMs };
  }
  write(relative, content, expectedRevision) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > 8 * 1024 * 1024)
      throw Error('A nota ultrapassa o limite de 8 MB.');
    const before = this.read(relative);
    if (before.revision !== expectedRevision) return { conflict: true, current: before };
    const full = this.resolve(relative),
      stat = fs.statSync(full),
      temp = path.join(path.dirname(full), '.notas1-save-' + randomUUID());
    try {
      fs.writeFileSync(temp, content, { flag: 'wx', mode: stat.mode & 0o777 });
      // O Windows exige permissão de escrita para sincronizar o arquivo.
      const fd = fs.openSync(temp, 'r+');
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      // Revalida o original imediatamente antes da substituição atômica.
      if (this.read(relative).revision !== expectedRevision)
        return { conflict: true, current: this.read(relative) };
      fs.renameSync(temp, this.resolve(relative));
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    return this.read(relative);
  }
  create(parent, name, kind, content = '') {
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 160 ||
      /[\\/\x00-\x1f<>:"|?*]/.test(name) ||
      name.startsWith('.') ||
      /[. ]$/.test(name)
    )
      throw Error('Informe um nome válido, sem barras ou ponto inicial.');
    if (!['file', 'directory'].includes(kind)) throw Error('Tipo inválido.');
    name = name.trim();
    if (kind === 'file' && /^Anexos(?:\/|$)/i.test(parent))
      throw Error('Notas e canvases não podem ser criados dentro da pasta Anexos.');
    if (kind === 'file' && !/\.md$/i.test(name) && !/\.canvas$/i.test(name)) name += '.md';
    const parentFull = this.resolve(parent, { allowRoot: true });
    if (!fs.statSync(parentFull).isDirectory()) throw Error('Destino inválido.');
    const relative = parent ? parent + '/' + name : name,
      target = this.resolve(relative, { missing: true });
    if (kind === 'file') {
      if (typeof content !== 'string' || Buffer.byteLength(content) > 8 * 1024 * 1024)
        throw Error('Conteúdo inválido.');
      fs.writeFileSync(target, content, { flag: 'wx' });
    } else fs.mkdirSync(target);
    return { path: relative, kind };
  }
  importAttachments(sourcePaths) {
    if (!Array.isArray(sourcePaths) || !sourcePaths.length) return [];
    if (sourcePaths.length > 40) throw Error('Escolha no máximo 40 anexos por vez.');
    const folder = this.ensureAttachmentsFolder(),
      added = [];
    for (const source of sourcePaths) {
      if (typeof source !== 'string' || !path.isAbsolute(source))
        throw Error('Um dos arquivos selecionados tem um caminho inválido.');
      const sourceStat = fs.lstatSync(source);
      if (sourceStat.isSymbolicLink() || !sourceStat.isFile())
        throw Error('Anexos precisam ser arquivos locais comuns, sem links simbólicos.');
      if (sourceStat.size > 1024 * 1024 * 1024)
        throw Error(`“${path.basename(source)}” ultrapassa o limite de 1 GB por anexo.`);
      const real = fs.realpathSync(source);
      if (real !== path.resolve(source))
        throw Error('O caminho do anexo contém um link simbólico.');
      let filename = path
        .basename(source)
        .replace(/[\x00-\x1f<>:"|?*\\/]/g, '_')
        .trim();
      filename = filename.replace(/^[. ]+|[. ]+$/g, '');
      if (!filename) filename = 'Anexo';
      const ext = path.extname(filename).slice(0, 32),
        stem = filename.slice(0, filename.length - ext.length).slice(0, 150) || 'Anexo';
      let index = 1,
        candidate = stem + ext,
        relative = 'Anexos/' + candidate,
        target = this.resolve(relative, { missing: true });
      while (fs.existsSync(target)) {
        index++;
        candidate = `${stem} (${index})${ext}`;
        relative = 'Anexos/' + candidate;
        target = this.resolve(relative, { missing: true });
      }
      try {
        fs.copyFileSync(real, target, fs.constants.COPYFILE_EXCL);
      } catch (error) {
        if (fs.existsSync(target)) fs.unlinkSync(target);
        throw error;
      }
      const stat = fs.statSync(target);
      added.push({ path: relative, name: candidate, size: stat.size, kind: 'file' });
    }
    return added;
  }
  move(source, target) {
    const from = this.resolve(source),
      to = this.resolve(target, { missing: true });
    const inAttachments = (value) => value === 'Anexos' || value.startsWith('Anexos/');
    if (source === 'Anexos') throw Error('A pasta Anexos é reservada ao gerenciador de arquivos.');
    if (inAttachments(source) !== inAttachments(target))
      throw Error('Os anexos precisam permanecer dentro da pasta Anexos.');
    if (from === to) return { from: source, path: target };
    if (fs.existsSync(to)) throw Error('Já existe um item com esse nome no destino.');
    if (fs.statSync(from).isDirectory() && contains(from, to))
      throw Error('Não é possível mover uma pasta para dentro dela mesma.');
    fs.renameSync(from, to);
    return { from: source, path: target };
  }
  moveWithLinks(source, target) {
    const notes = [],
      attachments = [];
    const collect = (list) => {
      for (const item of list)
        if (item.children) collect(item.children);
        else if (item.path.startsWith('Anexos/')) attachments.push(item.path);
        else if (/\.md$/i.test(item.path)) notes.push(item.path);
    };
    collect(this.tree());
    const mapPath = (p) =>
      p === source || p.startsWith(source + '/') ? target + p.slice(source.length) : p;
    const changes = [],
      warnings = [];
    for (const file of notes) {
      try {
        const doc = this.read(file),
          content = rewriteDocument(doc.content, file, notes, mapPath, attachments);
        if (content !== doc.content) changes.push({ doc, content, path: mapPath(file) });
      } catch {
        warnings.push(file);
      }
    }
    const result = this.move(source, target),
      updated = [];
    for (const change of changes) {
      try {
        const saved = this.write(change.path, change.content, change.doc.revision);
        if (saved.conflict) warnings.push(change.path);
        else updated.push(saved);
      } catch {
        warnings.push(change.path);
      }
    }
    return { ...result, updated, warnings };
  }
  trashSnapshot(relative) {
    if (relative === 'Anexos') throw Error('A pasta Anexos é reservada e não pode ser removida.');
    const full = this.resolve(relative),
      st = fs.lstatSync(full);
    return { full, dev: st.dev, ino: st.ino, relative };
  }
  async trash(relative, snapshot, trashItem) {
    const now = this.trashSnapshot(relative);
    if (
      !snapshot ||
      now.full !== snapshot.full ||
      now.dev !== snapshot.dev ||
      now.ino !== snapshot.ino
    )
      throw Error('O item mudou durante a confirmação.');
    await trashItem(now.full);
    return true;
  }
  createLinked(relative) {
    if (
      typeof relative !== 'string' ||
      !/\.md$/i.test(relative) ||
      /^Anexos(?:\/|$)/i.test(relative)
    )
      throw Error('Destino de nota inválido.');
    const parts = relative.split('/'),
      name = parts.pop(),
      created = [];
    let parent = '';
    try {
      for (const part of parts) {
        const next = parent ? parent + '/' + part : part;
        try {
          const full = this.resolve(next);
          if (!fs.statSync(full).isDirectory()) throw Error('O destino não é uma pasta.');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          this.create(parent, part, 'directory');
          created.push(next);
        }
        parent = next;
      }
      try {
        this.create(parent, name, 'file', '');
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      return this.read(relative);
    } catch (error) {
      for (const folder of created.reverse())
        try {
          fs.rmdirSync(this.resolve(folder));
        } catch {}
      throw error;
    }
  }
  collectNotes(limit = 3000) {
    const notes = [];
    const collect = (list) => {
      for (const item of list) {
        if (item.children) collect(item.children);
        else if (!item.path.startsWith('Anexos/') && /\.md$/i.test(item.path)) notes.push(item);
      }
    };
    collect(this.tree());
    return notes.slice(0, limit);
  }
  searchNotes(query, { limit = 50 } = {}) {
    if (typeof query !== 'string' || !query.trim()) return { query: '', matches: [] };
    const needle = query.trim().toLocaleLowerCase();
    if (needle.length < 2) return { query: query.trim(), matches: [] };
    const found = [];
    for (const item of this.collectNotes(3000)) {
      if (item.size > 8 * 1024 * 1024) continue;
      try {
        const content = this.read(item.path).content;
        const index = content.toLocaleLowerCase().indexOf(needle);
        const nameHit = item.path.toLocaleLowerCase().includes(needle);
        if (index < 0 && !nameHit) continue;
        const start = Math.max(0, index < 0 ? 0 : index - 100);
        const end = Math.min(content.length, index < 0 ? 160 : index + query.trim().length + 180);
        found.push({
          path: item.path,
          title: NoteLinks.basename(item.path),
          excerpt: content.slice(start, end).replace(/\s+/g, ' ').trim(),
          nameMatch: nameHit,
        });
        if (found.length >= limit) break;
      } catch {
        /* ignore unreadable notes */
      }
    }
    return { query: query.trim(), matches: found, truncated: found.length === limit };
  }
  noteGraph({ limit = 120 } = {}) {
    const index = this.linkIndex();
    const notes = index.notes.slice(0, limit);
    const paths = notes.map((note) => note.path);
    const byPath = new Set(paths);
    const edges = [];
    const seen = new Set();
    for (const note of notes) {
      for (const link of note.links || []) {
        const resolved = NoteLinks.resolve(link.target, note.path, paths, link.format || 'wiki');
        const targetPath = resolved?.path;
        if (!targetPath || !byPath.has(targetPath) || targetPath === note.path) continue;
        const key =
          note.path < targetPath ? `${note.path}>${targetPath}` : `${targetPath}>${note.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: note.path, to: targetPath });
      }
    }
    return {
      notes: notes.map((note) => ({
        path: note.path,
        title: note.title,
        icon: note.icon || '',
      })),
      edges,
      skipped: index.skipped,
      truncated: index.notes.length > limit,
    };
  }
  linkIndex() {
    const notes = [],
      skipped = [];
    for (const item of this.collectNotes(4000)) {
      if (notes.length >= 3000 || item.size > 8 * 1024 * 1024) {
        skipped.push(item.path);
        continue;
      }
      try {
        const full = this.resolve(item.path),
          key = full + '|' + item.modifiedAt + '|' + item.size;
        let cached = linkCache.get(key);
        if (!cached) {
          const doc = this.read(item.path);
          cached = {
            headings: NoteLinks.headings(doc.content),
            links: NoteLinks.scan(doc.content)
              .filter((link) => link.format !== 'embed')
              .map(({ target, format }) => ({
                target,
                format,
              })),
            icon: pageMetadata(doc.content),
          };
          if (linkCache.size > 6000) linkCache.clear();
          linkCache.set(key, cached);
        }
        notes.push({
          path: item.path,
          title: NoteLinks.basename(item.path),
          modifiedAt: item.modifiedAt,
          size: item.size,
          ...cached,
        });
      } catch {
        skipped.push(item.path);
      }
    }
    return { notes, skipped };
  }
  image(relative) {
    const full = this.resolve(relative),
      stat = fs.statSync(full),
      ext = path.extname(full).toLowerCase();
    const types = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    if (!types[ext] || !stat.isFile() || stat.size > 20 * 1024 * 1024)
      throw Error('Prévia disponível para PNG, JPG, WebP e GIF de até 20 MB.');
    return `data:${types[ext]};base64,${fs.readFileSync(full).toString('base64')}`;
  }
  normalizeCanvas(data) {
    const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
    const edges = Array.isArray(data?.edges) ? data.edges : [];
    const cleanNodes = nodes
      .filter((node) => node && typeof node.id === 'string' && node.id)
      .slice(0, 400)
      .map((node) => {
        const type = ['text', 'file', 'group'].includes(node.type) ? node.type : 'text';
        const base = {
          id: String(node.id).slice(0, 64),
          type,
          x: Number.isFinite(node.x) ? node.x : 0,
          y: Number.isFinite(node.y) ? node.y : 0,
          width: Math.min(1200, Math.max(120, Number(node.width) || 260)),
          height: Math.min(900, Math.max(80, Number(node.height) || 140)),
        };
        if (node.color != null) base.color = String(node.color).slice(0, 24);
        if (type === 'text')
          base.text = typeof node.text === 'string' ? node.text.slice(0, 20000) : '';
        if (type === 'file')
          base.file =
            typeof node.file === 'string' ? node.file.replace(/\\/g, '/').slice(0, 400) : '';
        if (type === 'group')
          base.label = typeof node.label === 'string' ? node.label.slice(0, 120) : 'Grupo';
        return base;
      });
    const ids = new Set(cleanNodes.map((node) => node.id));
    const cleanEdges = edges
      .filter(
        (edge) =>
          edge &&
          typeof edge.id === 'string' &&
          ids.has(edge.fromNode) &&
          ids.has(edge.toNode) &&
          edge.fromNode !== edge.toNode,
      )
      .slice(0, 800)
      .map((edge) => ({
        id: String(edge.id).slice(0, 64),
        fromNode: edge.fromNode,
        toNode: edge.toNode,
        fromSide: ['top', 'right', 'bottom', 'left'].includes(edge.fromSide)
          ? edge.fromSide
          : 'right',
        toSide: ['top', 'right', 'bottom', 'left'].includes(edge.toSide) ? edge.toSide : 'left',
        label: typeof edge.label === 'string' ? edge.label.slice(0, 80) : undefined,
      }));
    return { nodes: cleanNodes, edges: cleanEdges };
  }
  emptyCanvas() {
    return { nodes: [], edges: [] };
  }
  readCanvas(relative) {
    if (!/\.canvas$/i.test(relative))
      throw Error('Somente arquivos .canvas podem ser abertos assim.');
    if (/^Anexos(?:\/|$)/i.test(relative)) throw Error('Canvas não pode ficar em Anexos.');
    const full = this.resolve(relative),
      stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
      throw Error('O canvas deve ser um arquivo de até 8 MB.');
    const raw = fs.readFileSync(full, 'utf8');
    let parsed;
    try {
      parsed = raw.trim() ? JSON.parse(raw) : this.emptyCanvas();
    } catch {
      throw Error('O arquivo .canvas não contém JSON válido.');
    }
    const data = this.normalizeCanvas(parsed);
    const content = JSON.stringify(data);
    return {
      path: relative,
      data,
      content,
      revision: revision(content),
      modifiedAt: stat.mtimeMs,
    };
  }
  writeCanvas(relative, data, expectedRevision) {
    const normalized = this.normalizeCanvas(data);
    const content = JSON.stringify(normalized, null, 2);
    if (Buffer.byteLength(content) > 8 * 1024 * 1024)
      throw Error('O canvas ultrapassa o limite de 8 MB.');
    const before = this.readCanvas(relative);
    if (before.revision !== expectedRevision) return { conflict: true, current: before };
    const full = this.resolve(relative),
      stat = fs.statSync(full),
      temp = path.join(path.dirname(full), '.notas1-save-' + randomUUID());
    try {
      fs.writeFileSync(temp, content, { flag: 'wx', mode: stat.mode & 0o777 });
      const fd = fs.openSync(temp, 'r+');
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      if (this.readCanvas(relative).revision !== expectedRevision)
        return { conflict: true, current: this.readCanvas(relative) };
      fs.renameSync(temp, this.resolve(relative));
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    return this.readCanvas(relative);
  }
}
module.exports = { AreaFiles, revision };
