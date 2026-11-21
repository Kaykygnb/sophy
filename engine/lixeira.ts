import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EngineError } from './errors.ts';
import { syncLinks } from './links.ts';
import {
  assertRelativeParts,
  classifyName,
  createDirectory,
  type Library,
} from './library.ts';
import { resolveInside } from './paths.ts';

/**
 * Lixeira da biblioteca, em `.sophy/lixeira/<id>/`.
 * O item original é movido para dentro dessa pasta, ao lado de `.meta.json`.
 * Não consulta a lixeira do sistema.
 */
export type TrashKind = 'note' | 'canvas' | 'attachment' | 'folder';

export type TrashItem = {
  id: string;
  originalPath: string;
  title: string;
  kind: TrashKind;
  deletedAt: string;
  size: number;
};

export const TRASH_ID = /^[0-9]{12,16}-[a-f0-9]{8}$/;

const META = '.meta.json';

let lastDeletionMs = 0;

/** Sem `now` explícito, cada exclusão fica pelo menos 1 ms depois da anterior. */
function deletionDate(requested?: Date) {
  if (requested) return requested;
  const ms = Math.max(Date.now(), lastDeletionMs + 1);
  lastDeletionMs = ms;
  return new Date(ms);
}

export function assertTrashId(id: string) {
  if (
    typeof id !== 'string' ||
    !id ||
    id.includes('..') ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('\0') ||
    !TRASH_ID.test(id)
  )
    throw new EngineError('invalid-path', 'Identificador de lixeira inválido.');
}

export function trashEntry(library: Library, relative: string, options: { now?: Date } = {}) {
  assertRelativeParts(relative);
  const full = resolveInside(library.root, relative);
  const before = fs.lstatSync(full);
  if (before.isSymbolicLink())
    throw new EngineError('symlink', 'Links simbólicos não são permitidos.');
  const again = fs.lstatSync(full);
  if (again.dev !== before.dev || again.ino !== before.ino)
    throw new EngineError('conflict', 'O item mudou durante a operação.');
  const now = deletionDate(options.now);
  const id = `${now.getTime()}-${randomBytes(4).toString('hex')}`;
  assertTrashId(id);
  const name = relative.split('/').pop() ?? relative;
  const kind = kindOf(before, name);
  const meta: TrashItem = {
    id,
    originalPath: relative,
    title: titleOf(name, kind),
    kind,
    deletedAt: now.toISOString(),
    size: byteSize(full),
  };
  const root = ensureTrashRoot(library);
  const dir = path.join(root, id);
  let created = false;
  try {
    fs.mkdirSync(dir);
    created = true;
    fs.writeFileSync(path.join(dir, META), `${JSON.stringify(meta)}\n`, { flag: 'wx' });
    movePreserving(full, path.join(dir, name));
  } catch (error) {
    if (fs.existsSync(full)) {
      if (created) fs.rmSync(dir, { recursive: true, force: true });
      throw new EngineError(
        'trash-failed',
        'Não foi possível mover para a lixeira. Nada foi apagado.',
      );
    }
    throw error;
  }
  syncLinks(library);
  return {
    path: relative,
    trashed: true as const,
    id,
    kind,
    trashPath: path.join(dir, name),
  };
}

export function listTrash(library: Library): TrashItem[] {
  const root = readTrashRoot(library);
  if (!root) return [];
  const items: TrashItem[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isDirectory() || !TRASH_ID.test(entry.name)) continue;
    const metaFile = path.join(root, entry.name, META);
    if (!fs.existsSync(metaFile) || fs.lstatSync(metaFile).isSymbolicLink()) continue;
    items.push(parseMeta(JSON.parse(fs.readFileSync(metaFile, 'utf8')), entry.name));
  }
  items.sort((a, b) => {
    if (a.deletedAt === b.deletedAt) return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    return a.deletedAt < b.deletedAt ? 1 : -1;
  });
  return items;
}

export function restoreTrash(library: Library, id: string) {
  const dir = readItemDir(library, id);
  const meta = readMeta(dir, id);
  const parts = assertRelativeParts(meta.originalPath);
  if (parts.length > 1) createDirectory(library, parts.slice(0, -1).join('/'));
  const target = freeRestorePath(library, meta.originalPath);
  const destination = resolveInside(library.root, target, { allowMissing: true });
  movePreserving(path.join(dir, payloadName(dir)), destination);
  fs.rmSync(dir, { recursive: true, force: true });
  syncLinks(library);
  return { id, path: target, restored: true as const };
}

export function purgeTrash(library: Library, id: string, options: { refresh?: boolean } = {}) {
  const dir = readItemDir(library, id);
  fs.rmSync(dir, { recursive: true, force: false });
  if (options.refresh !== false) syncLinks(library);
  return { id, purged: true as const };
}

export function emptyTrash(library: Library) {
  const root = readTrashRoot(library);
  if (!root) return { purged: 0 };
  let purged = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!TRASH_ID.test(entry.name)) continue;
    const full = path.join(root, entry.name);
    const listed = fs.lstatSync(full);
    if (listed.isSymbolicLink()) {
      fs.unlinkSync(full);
      purged += 1;
      continue;
    }
    if (!listed.isDirectory()) continue;
    fs.rmSync(full, { recursive: true, force: false });
    purged += 1;
  }
  syncLinks(library);
  return { purged };
}

/** Apaga de vez. Não cria item na lixeira. Vale para nota, canvas, anexo ou pasta. */
export function deletePermanent(library: Library, relative: string) {
  assertRelativeParts(relative);
  const full = resolveInside(library.root, relative);
  const before = fs.lstatSync(full);
  if (before.isSymbolicLink())
    throw new EngineError('symlink', 'Links simbólicos não são permitidos.');
  const again = fs.lstatSync(full);
  if (again.dev !== before.dev || again.ino !== before.ino)
    throw new EngineError('conflict', 'O item mudou durante a operação.');
  try {
    fs.rmSync(full, { recursive: true, force: false });
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw new EngineError('invalid-path', 'Não foi possível apagar o item.');
  }
  syncLinks(library);
  return { path: relative, deleted: true as const };
}

/**
 * Tira da lixeira a cópia mais recente de cada caminho que o desfazer acabou
 * de regravar. Cópias mais antigas do mesmo caminho permanecem.
 */
export function removeTrashOriginals(library: Library, originalPaths: string[]) {
  const wanted = new Set(originalPaths.filter((item) => typeof item === 'string' && item));
  if (!wanted.size) return { removed: [] as string[] };
  const removed: string[] = [];
  const seen = new Set<string>();
  for (const item of listTrash(library)) {
    if (!wanted.has(item.originalPath) || seen.has(item.originalPath)) continue;
    seen.add(item.originalPath);
    purgeTrash(library, item.id, { refresh: false });
    removed.push(item.id);
  }
  return { removed };
}

function ensureTrashRoot(library: Library) {
  const sophy = path.join(library.root, '.sophy');
  if (fs.existsSync(sophy) && fs.lstatSync(sophy).isSymbolicLink())
    throw new EngineError('symlink', 'Links simbólicos não são permitidos.');
  const root = path.join(sophy, 'lixeira');
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink())
    throw new EngineError('symlink', 'Links simbólicos não são permitidos.');
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory())
    throw new EngineError('symlink', 'Links simbólicos não são permitidos.');
  return root;
}

function readTrashRoot(library: Library) {
  const sophy = path.join(library.root, '.sophy');
  if (!fs.existsSync(sophy)) return null;
  if (fs.lstatSync(sophy).isSymbolicLink())
    throw new EngineError('symlink', 'Links simbólicos não são permitidos.');
  const root = path.join(sophy, 'lixeira');
  if (!fs.existsSync(root)) return null;
  if (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory())
    throw new EngineError('symlink', 'Links simbólicos não são permitidos.');
  return root;
}

function itemDir(library: Library, id: string) {
  assertTrashId(id);
  const root = path.join(library.root, '.sophy', 'lixeira');
  const dir = path.join(root, id);
  const relative = path.relative(root, dir);
  if (relative !== id || relative.startsWith('..') || path.isAbsolute(relative))
    throw new EngineError('invalid-path', 'Identificador de lixeira inválido.');
  return dir;
}

function readItemDir(library: Library, id: string) {
  const dir = itemDir(library, id);
  let listed: fs.Stats;
  try {
    listed = fs.lstatSync(dir);
  } catch (error) {
    if (errno(error) === 'ENOENT')
      throw new EngineError('not-found', 'Item da lixeira não encontrado.');
    throw error;
  }
  if (listed.isSymbolicLink())
    throw new EngineError('symlink', 'Links simbólicos não são permitidos.');
  if (!listed.isDirectory()) throw new EngineError('invalid-path', 'Item da lixeira inválido.');
  return dir;
}

function readMeta(dir: string, id: string) {
  const metaFile = path.join(dir, META);
  let listed: fs.Stats;
  try {
    listed = fs.lstatSync(metaFile);
  } catch (error) {
    if (errno(error) === 'ENOENT')
      throw new EngineError('not-found', 'Item da lixeira não encontrado.');
    throw error;
  }
  if (listed.isSymbolicLink() || !listed.isFile())
    throw new EngineError('invalid-path', 'Metadados de lixeira inválidos.');
  return parseMeta(JSON.parse(fs.readFileSync(metaFile, 'utf8')), id);
}

function parseMeta(raw: unknown, id: string): TrashItem {
  if (!raw || typeof raw !== 'object')
    throw new EngineError('invalid-path', 'Metadados de lixeira inválidos.');
  const meta = raw as Record<string, unknown>;
  if (meta.id !== id) throw new EngineError('invalid-path', 'Metadados de lixeira inválidos.');
  if (typeof meta.originalPath !== 'string')
    throw new EngineError('invalid-path', 'Metadados de lixeira inválidos.');
  assertRelativeParts(meta.originalPath);
  if (
    meta.kind !== 'note' &&
    meta.kind !== 'canvas' &&
    meta.kind !== 'attachment' &&
    meta.kind !== 'folder'
  )
    throw new EngineError('invalid-path', 'Metadados de lixeira inválidos.');
  if (typeof meta.title !== 'string' || !meta.title)
    throw new EngineError('invalid-path', 'Metadados de lixeira inválidos.');
  if (typeof meta.deletedAt !== 'string' || Number.isNaN(Date.parse(meta.deletedAt)))
    throw new EngineError('invalid-path', 'Metadados de lixeira inválidos.');
  if (typeof meta.size !== 'number' || !Number.isInteger(meta.size) || meta.size < 0)
    throw new EngineError('invalid-path', 'Metadados de lixeira inválidos.');
  return {
    id,
    originalPath: meta.originalPath,
    title: meta.title,
    kind: meta.kind,
    deletedAt: meta.deletedAt,
    size: meta.size,
  };
}

function payloadName(dir: string) {
  const names = fs.readdirSync(dir).filter((name) => !name.startsWith('.'));
  if (names.length !== 1)
    throw new EngineError('invalid-path', 'O item da lixeira está incompleto.');
  if (fs.lstatSync(path.join(dir, names[0])).isSymbolicLink())
    throw new EngineError('symlink', 'Links simbólicos não são permitidos.');
  return names[0];
}

function freeRestorePath(library: Library, originalPath: string) {
  if (!entryExists(library, originalPath)) return originalPath;
  const parts = originalPath.split('/');
  const name = parts.pop() ?? originalPath;
  const parent = parts.join('/');
  for (let index = 1; index < 10_000; index += 1) {
    const candidateName = withRestoredSuffix(name, index);
    const candidate = parent ? `${parent}/${candidateName}` : candidateName;
    assertRelativeParts(candidate);
    if (!entryExists(library, candidate)) return candidate;
  }
  throw new EngineError('exists', 'Já existe um item com esse nome.');
}

function withRestoredSuffix(name: string, index: number) {
  const extension = path.posix.extname(name);
  const stem = name.slice(0, name.length - extension.length);
  const label = index <= 1 ? ' (restaurado)' : ` (restaurado ${index})`;
  return `${stem}${label}${extension}`;
}

function entryExists(library: Library, relative: string) {
  try {
    resolveInside(library.root, relative);
    return true;
  } catch (error) {
    if (error instanceof EngineError && error.code === 'not-found') return false;
    throw error;
  }
}

function kindOf(stat: fs.Stats, name: string): TrashKind {
  if (stat.isDirectory()) return 'folder';
  return classifyName(name);
}

function titleOf(name: string, kind: TrashKind) {
  if (kind === 'note') return name.replace(/\.md$/i, '');
  if (kind === 'canvas') return name.replace(/\.canvas$/i, '');
  return name;
}

function byteSize(full: string): number {
  const listed = fs.lstatSync(full);
  if (listed.isSymbolicLink()) return 0;
  if (listed.isFile()) return listed.size;
  if (!listed.isDirectory()) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    total += byteSize(path.join(full, entry.name));
  }
  return total;
}

function movePreserving(source: string, destination: string) {
  try {
    fs.renameSync(source, destination);
    return;
  } catch (error) {
    if (errno(error) !== 'EXDEV') throw error;
  }
  if (fs.existsSync(destination))
    throw new EngineError('exists', 'Já existe um item com esse nome.');
  try {
    fs.cpSync(source, destination, { recursive: true, errorOnExist: true });
    fs.rmSync(source, { recursive: true, force: false });
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

function errno(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}
