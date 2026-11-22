import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dailyDate } from './daily.ts';
import { EngineError } from './errors.ts';
import { MAX_ATTACHMENT_BYTES, MAX_NOTE_BYTES, MAX_TREE_DEPTH, MAX_TREE_ENTRIES } from './limits.ts';
import { assertBody, composeMarkdown, prefixFromFrontmatter, splitMarkdown } from './markdown.ts';
import { ensureNoteIdentity, newNoteId, updateNoteIdPath } from './note-id.ts';
import { contains, openLibraryRoot, resolveInside, validateSegment, type OpenOptions } from './paths.ts';
import { mask, scan } from './wikilinks.ts';
import { moveToTrash, restoreFromTrash, type TrashOptions } from './trash.ts';

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

export type WorkspaceInfo = { name: string; path: string; unsafe?: boolean };

export type NoteInfo = {
  path: string;
  workspace: string | null;
  name: string;
  size: number;
  modifiedAt: number;
  unsafe?: boolean;
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
    .filter((entry) => entry.kind === 'directory')
    .map((entry) => {
      const unsafe = !safeSegment(entry.name, 'workspace');
      return unsafe
        ? { name: entry.name, path: entry.name, unsafe: true as const }
        : { name: entry.name, path: entry.name };
    })
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

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

const EXTRA_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
};

/** Tipo do anexo pela extensão. Desconhecido vira `application/octet-stream`. */
export function attachmentMime(name: string) {
  const ext = path.extname(name).toLowerCase();
  return IMAGE_MIME[ext] || EXTRA_MIME[ext] || 'application/octet-stream';
}

export function isImageName(name: string) {
  return Boolean(IMAGE_MIME[path.extname(name).toLowerCase()]);
}

function uniqueAttachmentPath(library: Library, folder: string, filename: string) {
  const safe = filename
    .replace(/[\x00-\x1f<>:"|?*\\/]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 180) || 'imagem';
  const ext = path.extname(safe).slice(0, 32);
  const stem = safe.slice(0, safe.length - ext.length) || 'imagem';
  let index = 1;
  let candidate = `${stem}${ext}`;
  let relative = folder ? `${folder}/${candidate}` : candidate;
  while (fs.existsSync(resolveInside(library.root, relative, { allowMissing: true }))) {
    index += 1;
    candidate = `${stem} (${index})${ext}`;
    relative = folder ? `${folder}/${candidate}` : candidate;
  }
  return relative;
}

/** Copia um arquivo local para a biblioteca como anexo. */
export function importAttachmentFromPath(library: Library, sourcePath: string, folder = '') {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath))
    throw new EngineError('invalid-path', 'O anexo precisa de um caminho absoluto.');
  const listed = fs.lstatSync(sourcePath);
  if (listed.isSymbolicLink() || !listed.isFile())
    throw new EngineError('invalid-path', 'Anexos precisam ser arquivos locais comuns.');
  if (listed.size > MAX_ATTACHMENT_BYTES)
    throw new EngineError('too-large', 'O anexo ultrapassa o limite de 25 MB.');
  const real = fs.realpathSync(sourcePath);
  if (real !== path.resolve(sourcePath))
    throw new EngineError('symlink', 'O caminho do anexo contém um link simbólico.');
  if (folder) createDirectory(library, folder);
  const relative = uniqueAttachmentPath(library, folder, path.basename(sourcePath));
  const target = resolveInside(library.root, relative, { allowMissing: true });
  fs.copyFileSync(real, target, fs.constants.COPYFILE_EXCL);
  const stat = fs.statSync(target);
  return { path: relative, name: relative.split('/').pop()!, size: stat.size, kind: 'attachment' as const };
}

/** Grava bytes (ex.: colar imagem) como anexo na biblioteca. */
export function importAttachmentBytes(
  library: Library,
  name: string,
  data: Buffer,
  folder = '',
) {
  if (!Buffer.isBuffer(data) || !data.length)
    throw new EngineError('invalid-path', 'Conteúdo do anexo inválido.');
  if (data.length > MAX_ATTACHMENT_BYTES)
    throw new EngineError('too-large', 'O anexo ultrapassa o limite de 25 MB.');
  if (folder) createDirectory(library, folder);
  const relative = uniqueAttachmentPath(library, folder, name);
  const target = resolveInside(library.root, relative, { allowMissing: true });
  fs.writeFileSync(target, data, { flag: 'wx' });
  const stat = fs.statSync(target);
  return { path: relative, name: relative.split('/').pop()!, size: stat.size, kind: 'attachment' as const };
}

/** Lê um anexo de imagem como data URL para a interface. */
export function readAttachmentDataUrl(library: Library, relative: string) {
  const full = resolveInside(library.root, relative);
  const listed = fs.lstatSync(full);
  if (listed.isSymbolicLink() || !listed.isFile())
    throw new EngineError('invalid-path', 'O anexo não é um arquivo.');
  if (listed.size > MAX_ATTACHMENT_BYTES)
    throw new EngineError('too-large', 'O anexo ultrapassa o limite de 25 MB.');
  const mime = IMAGE_MIME[path.extname(relative).toLowerCase()];
  if (!mime) throw new EngineError('invalid-path', 'Somente imagens podem ser lidas assim.');
  const data = fs.readFileSync(full);
  return {
    path: relative,
    mime,
    dataUrl: `data:${mime};base64,${data.toString('base64')}`,
    size: listed.size,
  };
}

export type AttachmentFile = {
  name: string;
  path: string;
  size: number;
  mime: string;
};

export type AttachmentInfo = AttachmentFile & { usedBy: string[] };

/**
 * Arquivos visíveis dentro de `Anexos/` na raiz. Pasta ausente devolve lista
 * vazia. Link simbólico e arquivo no lugar da pasta são recusados.
 */
export function listAttachmentFiles(library: Library): AttachmentFile[] {
  const folder = path.join(library.root, 'Anexos');
  let listed: fs.Stats;
  try {
    listed = fs.lstatSync(folder);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  if (listed.isSymbolicLink())
    throw new EngineError('symlink', 'Links simbólicos não são permitidos.');
  if (!listed.isDirectory())
    throw new EngineError('invalid-path', 'Anexos precisa ser uma pasta.');
  const files: AttachmentFile[] = [];
  let count = 0;
  const visit = (directory: string, prefix: string, depth: number) => {
    if (depth > MAX_TREE_DEPTH)
      throw new EngineError('too-large', 'A biblioteca ultrapassou o limite de 40 níveis.');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (++count > MAX_TREE_ENTRIES)
        throw new EngineError('too-large', 'A biblioteca ultrapassou o limite de 20 mil itens.');
      if (entry.isSymbolicLink()) continue;
      const relative = `${prefix}/${entry.name}`;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full, relative, depth + 1);
      else if (entry.isFile()) {
        files.push({
          name: entry.name,
          path: relative,
          size: fs.statSync(full).size,
          mime: attachmentMime(entry.name),
        });
      }
    }
  };
  visit(folder, 'Anexos', 2);
  return files.sort((a, b) => a.path.localeCompare(b.path, 'pt-BR', { numeric: true }));
}

/** Lista `Anexos/` com as notas que citam cada arquivo. Não grava `id` nas notas. */
export function listAttachments(library: Library): AttachmentInfo[] {
  const files = listAttachmentFiles(library);
  const known = new Set(files.map((file) => file.path));
  const used = new Map<string, string[]>();
  if (known.size) {
    for (const note of listNotes(library)) {
      const content = readText(library, note.path).content;
      for (const ref of referencedAttachments(content, known)) {
        const list = used.get(ref) ?? [];
        list.push(note.path);
        used.set(ref, list);
      }
    }
  }
  return files.map((file) => ({
    ...file,
    usedBy: (used.get(file.path) ?? []).sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { numeric: true }),
    ),
  }));
}

/**
 * Caminho absoluto de um arquivo em `Anexos/`. Recusa `..`, absoluto, barra
 * invertida, link simbólico e qualquer coisa fora da biblioteca.
 */
export function resolveAttachmentPath(library: Library, relative: string) {
  if (typeof relative !== 'string' || !relative.startsWith('Anexos/'))
    throw new EngineError('invalid-path', 'O anexo precisa estar na pasta Anexos.');
  const full = resolveInside(library.root, relative);
  const listed = fs.lstatSync(full);
  if (!listed.isFile())
    throw new EngineError('invalid-path', 'O anexo precisa ser um arquivo.');
  const root = fs.realpathSync(library.root);
  const real = fs.realpathSync(full);
  if (!contains(root, real))
    throw new EngineError('invalid-path', 'O caminho está fora da biblioteca.');
  return real;
}

/** Lê os bytes de um anexo em `Anexos/`, com o mesmo teto de 25 MB da importação. */
export function readAttachmentBytes(library: Library, relative: string) {
  const full = resolveAttachmentPath(library, relative);
  const listed = fs.statSync(full);
  if (listed.size > MAX_ATTACHMENT_BYTES)
    throw new EngineError('too-large', 'O anexo ultrapassa o limite de 25 MB.');
  return fs.readFileSync(full);
}

/**
 * Caminhos de `Anexos/` citados pela nota: wikilink, embed, link Markdown ou
 * valor de frontmatter igual ao caminho. Código cercado e inline ficam de fora.
 */
export function referencedAttachments(content: string, known: ReadonlySet<string>) {
  const found = new Set<string>();
  const consider = (value: string) => {
    const normalized = normalizeAttachmentRef(value);
    if (normalized && known.has(normalized)) found.add(normalized);
  };
  for (const link of scan(content)) consider(link.note);
  for (const match of mask(content).matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) consider(match[1]);
  const parts = splitMarkdown(content);
  if (parts.frontmatter) collectAttachmentStrings(parts.frontmatter, consider);
  return [...found].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
}

function normalizeAttachmentRef(value: string) {
  let text = value.trim().replaceAll('\\', '/');
  if (text.startsWith('<') && text.endsWith('>') && text.length > 2)
    text = text.slice(1, -1).trim();
  const cut = text.search(/[?#]/);
  if (cut >= 0) text = text.slice(0, cut);
  try {
    text = decodeURIComponent(text);
  } catch {
    return '';
  }
  if (!text.startsWith('Anexos/')) return '';
  if (text.split('/').some((part) => !part || part === '.' || part === '..')) return '';
  return text;
}

function collectAttachmentStrings(value: unknown, consider: (value: string) => void) {
  if (typeof value === 'string') {
    consider(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAttachmentStrings(item, consider);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectAttachmentStrings(item, consider);
  }
}

export function listEntries(library: Library) {
  return walkFiles(library);
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

export function readNote(
  library: Library,
  relative: string,
  options: { ensureId?: boolean } = {},
): NoteDocument {
  assertMarkdown(relative);
  const full = resolveInside(library.root, relative);
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new EngineError('invalid-note', 'Somente arquivos Markdown podem ser lidos.');
  if (stat.size > MAX_NOTE_BYTES)
    throw new EngineError('too-large', 'A nota deve ser um arquivo de até 8 MB.');
  let content = fs.readFileSync(full, 'utf8');
  if (options.ensureId !== false)
    content = ensureNoteIdentity(library, relative, content).content;
  return noteFrom(library, relative, content, fs.lstatSync(full));
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
  if (fs.existsSync(full) && dailyDate(relative))
    throw new EngineError('daily-exists', 'Esse dia já tem nota');
  if (fs.existsSync(full)) throw new EngineError('exists', 'A nota já existe.');
  const meta =
    frontmatter === undefined || frontmatter === null
      ? { id: newNoteId() }
      : { ...frontmatter, id: typeof frontmatter.id === 'string' && frontmatter.id ? frontmatter.id : newNoteId() };
  const prefix = prefixFromFrontmatter(meta);
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
  const current = readNote(library, relative, { ensureId: false });
  if (current.revision !== input.expectedRevision) return { conflict: true, current };
  const parts = splitMarkdown(fs.readFileSync(resolveInside(library.root, relative), 'utf8'));
  let nextFrontmatter = input.frontmatter;
  if (nextFrontmatter && typeof nextFrontmatter === 'object') {
    const kept = typeof parts.frontmatter?.id === 'string' ? parts.frontmatter.id : null;
    if (!nextFrontmatter.id && kept) nextFrontmatter = { ...nextFrontmatter, id: kept };
  }
  const prefix =
    nextFrontmatter === undefined ? parts.prefix : prefixFromFrontmatter(nextFrontmatter);
  const content = composeMarkdown({ bom: parts.bom, prefix, body: input.body });
  assertSize(content);
  const written = writeText(library, relative, content, input.expectedRevision);
  if (written.conflict) return { conflict: true, current: readNote(library, relative) };
  return { conflict: false, note: readNote(library, relative) };
}

/** Recusa mover a nota do dia e recusa ocupar um dia que já tem nota. */
export function assertEntryMove(library: Library, source: string, target: string) {
  const from = source.split('\\').join('/');
  const to = target.split('\\').join('/');
  if (from === to) return;
  if (dailyDate(from))
    throw new EngineError('daily-locked', 'Notas do dia têm o nome fixo pela data');
  if (!dailyDate(to)) return;
  const dest = resolveInside(library.root, to, { allowMissing: true });
  if (fs.existsSync(dest)) throw new EngineError('daily-exists', 'Esse dia já tem nota');
}

export function moveEntry(library: Library, source: string, target: string) {
  assertEntryMove(library, source, target);
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
  if (source.toLowerCase().endsWith('.md') || target.toLowerCase().endsWith('.md'))
    updateNoteIdPath(library, source, target);
  return { from: source, path: target };
}

export function restoreEntry(
  library: Library,
  id: string,
  options?: TrashOptions & { mode?: 'merge' | 'asNote' },
) {
  return restoreFromTrash(library.root, id, options);
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
  return { path: relative, trashed: true, trashPath: trashed.trashPath, infoPath: trashed.infoPath };
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
      const unsafe = !relative
        .split('/')
        .every((part, index) => safeSegment(part, index === 0 ? 'workspace' : 'entry'));
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full, relative, depth + 1);
      else if (entry.isFile()) {
        const stat = fs.statSync(full);
        const described = describe(relative, stat, names);
        if (workspace !== undefined && described.workspace !== workspace) continue;
        files.push(
          unsafe
            ? { ...described, kind: classifyName(entry.name), unsafe: true }
            : { ...described, kind: classifyName(entry.name) },
        );
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
