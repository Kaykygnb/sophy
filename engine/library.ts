import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EngineError } from './errors.ts';
import { MAX_NOTE_BYTES, MAX_TREE_DEPTH, MAX_TREE_ENTRIES } from './limits.ts';
import { assertBody, composeMarkdown, prefixFromFrontmatter, splitMarkdown } from './markdown.ts';
import { openLibraryRoot, resolveInside, validateSegment, type OpenOptions } from './paths.ts';
import { moveToTrash, type TrashOptions } from './trash.ts';

/**
 * Motor da biblioteca.
 *
 * `library` é a pasta que a pessoa abre (Biblioteca na interface).
 * `workspace` é cada subpasta visível de primeiro nível (Estante na interface).
 * Não há cadastro: a pasta é a lista.
 */
export type Library = {
  root: string;
  identity: { dev: string; ino: string };
};

export type WorkspaceInfo = { name: string; path: string };

export type NoteInfo = {
  path: string;
  workspace: string | null;
  name: string;
  size: number;
  modifiedAt: number;
};

/** Nota é só `.md`. Canvas é `.canvas`. Qualquer outro arquivo visível é anexo, sem envelope. */
export type StoredFileKind = 'note' | 'canvas' | 'attachment';

export type FileInfo = NoteInfo & { kind: Exclude<StoredFileKind, 'note'> };

export function classifyName(name: string): StoredFileKind {
  const lower = name.toLowerCase();
  if (lower.endsWith('.md')) return 'note';
  if (lower.endsWith('.canvas')) return 'canvas';
  return 'attachment';
}

export type NoteDocument = NoteInfo & {
  body: string;
  frontmatter: Record<string, unknown> | null;
  frontmatterError: string | null;
  revision: string;
};

export function openLibrary(folder: string, options?: OpenOptions): Library {
  return openLibraryRoot(folder, options);
}

export function listWorkspaces(library: Library): WorkspaceInfo[] {
  return readRoot(library)
    .filter((entry) => entry.kind === 'directory' && safeSegment(entry.name, 'workspace'))
    .map((entry) => ({ name: entry.name, path: entry.name }))
    .sort(byName);
}

export function createWorkspace(library: Library, name: string) {
  validateSegment(name, 'workspace');
  const target = resolveInside(library.root, name, { allowMissing: true });
  if (fs.existsSync(target)) throw new EngineError('exists', 'Já existe um item com esse nome.');
  fs.mkdirSync(target);
  return { name, path: name };
}

export function createDirectory(library: Library, relative: string) {
  const parts = assertRelativeParts(relative);
  let parent = '';
  for (const part of parts) {
    const next = parent ? parent + '/' + part : part;
    const full = resolveInside(library.root, next, { allowMissing: true });
    if (!fs.existsSync(full)) fs.mkdirSync(full);
    else if (fs.lstatSync(full).isSymbolicLink())
      throw new EngineError('symlink', 'Links simbólicos não são permitidos.');
    else if (!fs.statSync(full).isDirectory())
      throw new EngineError('invalid-path', 'O destino não é uma pasta.');
    parent = next;
  }
  return { path: parts.join('/') };
}

export function listNotes(library: Library, workspace?: string): NoteInfo[] {
  return walkFiles(library, workspace)
    .filter((file) => file.kind === 'note')
    .map(({ kind: _kind, ...note }) => note);
}

/** Canvas e anexos. O conteúdo não é interpretado: `.canvas` continua JSON Canvas; o resto são bytes. */
export function listFiles(library: Library, workspace?: string): FileInfo[] {
  return walkFiles(library, workspace).filter((file): file is FileInfo => file.kind !== 'note');
}

export function listDirectories(library: Library): string[] {
  const directories: string[] = [];
  let count = 0;
  const visit = (directory: string, prefix: string, depth: number) => {
    if (depth > MAX_TREE_DEPTH)
      throw new EngineError('too-large', 'A biblioteca ultrapassou o limite de 40 níveis.');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink() || !entry.isDirectory()) continue;
      if (++count > MAX_TREE_ENTRIES)
        throw new EngineError('too-large', 'A biblioteca ultrapassou o limite de 20 mil itens.');
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      directories.push(relative);
      visit(path.join(directory, entry.name), relative, depth + 1);
    }
  };
  visit(library.root, '', 1);
  return directories.sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
}

export function readText(library: Library, relative: string) {
  const full = resolveInside(library.root, relative);
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new EngineError('invalid-path', 'O item não é um arquivo.');
  if (stat.size > MAX_NOTE_BYTES) throw new EngineError('too-large', 'O arquivo passa de 8 MB.');
  const content = fs.readFileSync(full, 'utf8');
  return { content, revision: revisionOf(content) };
}

export function writeText(
  library: Library,
  relative: string,
  content: string,
  expectedRevision: string,
) {
  assertSize(content);
  const current = readText(library, relative);
  if (current.revision !== expectedRevision)
    return { conflict: true as const, revision: current.revision };
  atomicWrite(library, relative, content, expectedRevision);
  return { conflict: false as const, revision: revisionOf(content) };
}

export function readNote(library: Library, relative: string): NoteDocument {
  assertMarkdown(relative);
  const full = resolveInside(library.root, relative);
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new EngineError('invalid-note', 'Somente arquivos Markdown podem ser lidos.');
  if (stat.size > MAX_NOTE_BYTES)
    throw new EngineError('too-large', 'A nota deve ser um arquivo de até 8 MB.');
  const content = fs.readFileSync(full, 'utf8');
  return noteFrom(library, relative, content, stat);
}

export function createNote(
  library: Library,
  relative: string,
  body = '',
  frontmatter?: Record<string, unknown> | null,
) {
  assertBody(body);
  assertMarkdown(relative);
  const parts = relative.split('/');
  if (parts.length > 1) createDirectory(library, parts.slice(0, -1).join('/'));
  const full = resolveInside(library.root, relative, { allowMissing: true });
  if (fs.existsSync(full)) throw new EngineError('exists', 'A nota já existe.');
  const prefix =
    frontmatter === undefined || frontmatter === null ? null : prefixFromFrontmatter(frontmatter);
  const content = composeMarkdown({ bom: '', prefix, body });
  assertSize(content);
  fs.writeFileSync(full, content, { flag: 'wx' });
  return readNote(library, relative);
}

export type WriteResult =
  { conflict: false; note: NoteDocument } | { conflict: true; current: NoteDocument };

/**
 * Grava o corpo sem reinterpretar Markdown. Frontmatter omitido preserva o
 * bloco original (inclusive `notas1_editor`). `null` ou `{}` remove o bloco.
 */
export function writeNote(
  library: Library,
  relative: string,
  input: {
    body: string;
    frontmatter?: Record<string, unknown> | null;
    expectedRevision: string;
  },
): WriteResult {
  assertBody(input.body);
  const current = readNote(library, relative);
  if (current.revision !== input.expectedRevision) return { conflict: true, current };
  const parts = splitMarkdown(fs.readFileSync(resolveInside(library.root, relative), 'utf8'));
  const prefix =
    input.frontmatter === undefined ? parts.prefix : prefixFromFrontmatter(input.frontmatter);
  const content = composeMarkdown({ bom: parts.bom, prefix, body: input.body });
  assertSize(content);
  const written = writeText(library, relative, content, input.expectedRevision);
  if (written.conflict) return { conflict: true, current: readNote(library, relative) };
  return { conflict: false, note: readNote(library, relative) };
}

export function moveEntry(library: Library, source: string, target: string) {
  const from = resolveInside(library.root, source);
  const parts = assertRelativeParts(target);
  const preview = path.join(library.root, ...parts);
  const listed = fs.lstatSync(from);
  if (listed.isSymbolicLink())
    throw new EngineError('symlink', 'Links simbólicos não são permitidos.');
  if (listed.isDirectory() && (preview === from || preview.startsWith(from + path.sep)))
    throw new EngineError('invalid-path', 'Não é possível mover uma pasta para dentro dela mesma.');
  if (parts.length > 1) createDirectory(library, parts.slice(0, -1).join('/'));
  const to = resolveInside(library.root, target, { allowMissing: true });
  if (from === to) return { from: source, path: target };
  if (fs.existsSync(to))
    throw new EngineError('exists', 'Já existe um item com esse nome no destino.');
  fs.renameSync(from, to);
  return { from: source, path: target };
}

export function trashEntry(library: Library, relative: string, options?: TrashOptions) {
  const full = resolveInside(library.root, relative);
  const before = fs.lstatSync(full);
  if (before.isSymbolicLink())
    throw new EngineError('symlink', 'Links simbólicos não são permitidos.');
  const again = fs.lstatSync(full);
  if (again.dev !== before.dev || again.ino !== before.ino)
    throw new EngineError('conflict', 'O item mudou durante a operação.');
  const trashed = moveToTrash(full, options);
  return { path: relative, trashed: true, trashPath: trashed.trashPath };
}

function atomicWrite(
  library: Library,
  relative: string,
  content: string,
  expectedRevision: string,
) {
  const full = resolveInside(library.root, relative);
  const stat = fs.statSync(full);
  const temp = path.join(path.dirname(full), '.sophy-save-' + randomUUID());
  try {
    fs.writeFileSync(temp, content, { flag: 'wx', mode: stat.mode & 0o777 });
    const fd = fs.openSync(temp, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (readText(library, relative).revision !== expectedRevision)
      throw new EngineError('conflict', 'O arquivo mudou durante a gravação.');
    fs.renameSync(temp, full);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function noteFrom(
  library: Library,
  relative: string,
  content: string,
  stat: fs.Stats,
): NoteDocument {
  const parts = splitMarkdown(content);
  const names = new Set(listWorkspaces(library).map((item) => item.name));
  return {
    ...describe(relative, stat, names),
    body: parts.body,
    frontmatter: parts.frontmatter,
    frontmatterError: parts.frontmatterError,
    revision: revisionOf(content),
  };
}

function walkFiles(library: Library, workspace?: string) {
  const names = new Set(listWorkspaces(library).map((item) => item.name));
  if (workspace !== undefined) {
    validateSegment(workspace, 'workspace');
    if (!names.has(workspace)) throw new EngineError('not-found', 'Estante não encontrada.');
  }
  const files: Array<NoteInfo & { kind: StoredFileKind }> = [];
  let count = 0;
  const visit = (directory: string, prefix: string, depth: number) => {
    if (depth > MAX_TREE_DEPTH)
      throw new EngineError('too-large', 'A biblioteca ultrapassou o limite de 40 níveis.');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (++count > MAX_TREE_ENTRIES)
        throw new EngineError('too-large', 'A biblioteca ultrapassou o limite de 20 mil itens.');
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (!relative.split('/').every((part, index) => safeSegment(part, index === 0 ? 'workspace' : 'entry')))
        continue;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full, relative, depth + 1);
      else if (entry.isFile()) {
        const stat = fs.statSync(full);
        const described = describe(relative, stat, names);
        if (workspace !== undefined && described.workspace !== workspace) continue;
        files.push({ ...described, kind: classifyName(entry.name) });
      }
    }
  };
  visit(library.root, '', 1);
  return files.sort((a, b) => a.path.localeCompare(b.path, 'pt-BR', { numeric: true }));
}

function readRoot(library: Library) {
  return fs.readdirSync(library.root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) return [];
    if (!entry.isDirectory() && !entry.isFile()) return [];
    return [{ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' }];
  });
}

function safeSegment(name: string, kind: 'workspace' | 'entry') {
  try {
    validateSegment(name, kind);
    return true;
  } catch {
    return false;
  }
}

function describe(relative: string, stat: fs.Stats, workspaces: Set<string>): NoteInfo {
  const name = relative.split('/').pop() ?? relative;
  const first = relative.includes('/') ? relative.slice(0, relative.indexOf('/')) : null;
  return {
    path: relative,
    workspace: first && workspaces.has(first) ? first : null,
    name,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
  };
}

function assertMarkdown(relative: string) {
  if (!relative.toLowerCase().endsWith('.md'))
    throw new EngineError('invalid-note', 'Somente arquivos Markdown podem ser editados.');
}

function assertRelativeParts(relative: string) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes('\\')
  )
    throw new EngineError('invalid-path', 'Caminho inválido.');
  const parts = relative.split('/');
  parts.forEach((part, index) => validateSegment(part, index === 0 ? 'workspace' : 'entry'));
  return parts;
}

function assertSize(content: string) {
  if (Buffer.byteLength(content) > MAX_NOTE_BYTES)
    throw new EngineError('too-large', 'A nota ultrapassa o limite de 8 MB.');
}

function revisionOf(content: string) {
  return createHash('sha256').update(content).digest('hex');
}

function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, 'pt-BR', { numeric: true });
}

export type { MarkdownParts } from './markdown.ts';
