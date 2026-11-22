import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EngineError } from './errors.ts';
import { createDirectory, listDirectories, listFiles, listNotes, type Library } from './library.ts';
import { resolveInside } from './paths.ts';

export type Origin = 'ui' | 'cli' | 'mcp' | 'agent';

type Blob = { encoding: 'utf8'; text: string } | { encoding: 'base64'; data: string };

type Change =
  | { type: 'file'; path: string; before: Blob | null; after: Blob | null }
  | { type: 'directory'; path: string; before: boolean; after: boolean };

type Action = {
  id: string;
  at: string;
  origin: Origin;
  tool: string;
  summary: string;
  changes: Change[];
};

const LIMIT = 50;

export function capture(library: Library) {
  const files = new Map<string, Blob>();
  for (const note of listNotes(library)) remember(files, library, note.path);
  for (const file of listFiles(library)) remember(files, library, file.path);
  return { files, directories: new Set(listDirectories(library)) };
}

function remember(files: Map<string, Blob>, library: Library, relative: string) {
  try {
    files.set(relative, readBlob(library, relative));
  } catch {
    /* um nome inválido ou ilegível não impede o histórico das outras notas */
  }
}

export function diff(
  before: ReturnType<typeof capture>,
  after: ReturnType<typeof capture>,
): Change[] {
  const changes: Change[] = [];
  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  for (const filePath of paths) {
    const previous = before.files.get(filePath) ?? null;
    const next = after.files.get(filePath) ?? null;
    if (!sameBlob(previous, next))
      changes.push({ type: 'file', path: filePath, before: previous, after: next });
  }
  const directories = new Set([...before.directories, ...after.directories]);
  for (const directory of directories) {
    const previous = before.directories.has(directory);
    const next = after.directories.has(directory);
    if (previous !== next)
      changes.push({ type: 'directory', path: directory, before: previous, after: next });
  }
  return changes;
}

export function pushHistory(
  library: Library,
  action: { origin: Origin; tool: string; summary: string; changes: Change[] },
) {
  if (!action.changes.length) return null;
  const actions = readActions(library);
  const stored: Action = {
    id: randomUUID(),
    at: new Date().toISOString(),
    origin: action.origin,
    tool: action.tool,
    summary: action.summary,
    changes: action.changes,
  };
  actions.push(stored);
  writeActions(library, actions.slice(-LIMIT));
  return {
    id: stored.id,
    at: stored.at,
    origin: stored.origin,
    tool: stored.tool,
    summary: stored.summary,
  };
}

export function listHistory(library: Library) {
  return readActions(library)
    .map((action) => ({
      id: action.id,
      at: action.at,
      origin: action.origin,
      tool: action.tool,
      summary: action.summary,
      paths: action.changes.map((change) => change.path),
    }))
    .reverse();
}

export function undoLast(library: Library) {
  const actions = readActions(library);
  const last = actions.at(-1);
  if (!last) throw new EngineError('not-found', 'Não há ação para desfazer.');
  apply(library, last.changes);
  actions.pop();
  writeActions(library, actions);
  return { undone: last.id, tool: last.tool, summary: last.summary, origin: last.origin };
}

function apply(library: Library, changes: Change[]) {
  for (const change of changes) {
    if (change.type === 'file') assertFile(library, change);
    else assertDirectory(library, change);
  }
  for (const change of changes) {
    if (change.type !== 'directory' || change.before !== true) continue;
    if (!listDirectories(library).includes(change.path)) createDirectory(library, change.path);
  }
  for (const change of changes) {
    if (change.type !== 'file' || !change.before) continue;
    const full = resolveInside(library.root, change.path, { allowMissing: true });
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, bufferOf(change.before));
  }
  for (const change of changes) {
    if (change.type !== 'file' || change.before !== null) continue;
    const full = resolveInside(library.root, change.path);
    fs.rmSync(full, { force: false });
  }
  const created = changes
    .filter((change) => change.type === 'directory' && !change.before && change.after)
    .sort((a, b) => b.path.length - a.path.length);
  for (const change of created) {
    const full = path.join(library.root, ...change.path.split('/'));
    if (fs.existsSync(full) && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
  }
}

function assertFile(library: Library, change: Extract<Change, { type: 'file' }>) {
  const exists = existsFile(library, change.path);
  if (change.after === null) {
    if (exists)
      throw new EngineError('conflict', 'O arquivo mudou desde essa ação. Nada foi desfeito.');
    return;
  }
  if (!exists || !sameBlob(readBlob(library, change.path), change.after))
    throw new EngineError('conflict', 'O arquivo mudou desde essa ação. Nada foi desfeito.');
}

function assertDirectory(library: Library, change: Extract<Change, { type: 'directory' }>) {
  const exists = listDirectories(library).includes(change.path);
  if (exists !== change.after)
    throw new EngineError('conflict', 'A pasta mudou desde essa ação. Nada foi desfeito.');
}

function existsFile(library: Library, relative: string) {
  try {
    const full = resolveInside(library.root, relative);
    return fs.statSync(full).isFile();
  } catch {
    return false;
  }
}

function readBlob(library: Library, relative: string): Blob {
  const full = resolveInside(library.root, relative);
  const buffer = fs.readFileSync(full);
  return { encoding: 'base64', data: buffer.toString('base64') };
}

function bufferOf(blob: Blob) {
  return blob.encoding === 'utf8' ? Buffer.from(blob.text) : Buffer.from(blob.data, 'base64');
}

function sameBlob(left: Blob | null, right: Blob | null) {
  if (left === null || right === null) return left === right;
  // Históricos antigos em UTF-8 continuam compatíveis com os novos blobs.
  return bufferOf(left).equals(bufferOf(right));
}

function readActions(library: Library): Action[] {
  const file = historyFile(library);
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { actions?: Action[] };
  return Array.isArray(parsed.actions) ? parsed.actions : [];
}

function writeActions(library: Library, actions: Action[]) {
  const directory = path.join(library.root, '.sophy');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'history.json');
  const temp = path.join(directory, '.history-' + randomUUID());
  fs.writeFileSync(temp, JSON.stringify({ version: 1, actions }), { flag: 'wx' });
  fs.renameSync(temp, file);
}

function historyFile(library: Library) {
  return path.join(library.root, '.sophy', 'history.json');
}
