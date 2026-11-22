import fs from 'node:fs';
import path from 'node:path';
import { ulid } from 'ulid';
import type { Library } from './library.ts';
import { composeMarkdown, prefixFromFrontmatter, splitMarkdown } from './markdown.ts';
import { resolveInside } from './paths.ts';

export type NoteIdRecord = {
  path: string;
  createdAt: string;
  names: string[];
};

type NoteIdIndex = Record<string, NoteIdRecord>;

function indexPath(library: Library) {
  return path.join(library.root, '.sophy', 'note-ids.json');
}

function basenameOf(relative: string) {
  return relative.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/i, '') || '';
}

export function readNoteIdIndex(library: Library): NoteIdIndex {
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath(library), 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as NoteIdIndex;
  } catch {
    return {};
  }
}

export function writeNoteIdIndex(library: Library, index: NoteIdIndex) {
  const folder = path.join(library.root, '.sophy');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(indexPath(library), JSON.stringify(index, null, 2));
}

export function newNoteId() {
  return ulid();
}

export function noteIdOf(frontmatter: Record<string, unknown> | null | undefined) {
  const value = frontmatter?.id;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function rememberName(record: NoteIdRecord, relative: string) {
  const name = basenameOf(relative);
  const names = record.names.includes(name) ? record.names : [...record.names, name].slice(-20);
  return { ...record, path: relative.replace(/\\/g, '/'), names };
}

/** Garante id no frontmatter e no índice. Devolve o conteúdo se gravou. */
export function ensureNoteIdentity(
  library: Library,
  relative: string,
  content: string,
): { content: string; id: string; wrote: boolean } {
  const parts = splitMarkdown(content);
  const index = readNoteIdIndex(library);
  const currentId = noteIdOf(parts.frontmatter);
  const byPath = Object.entries(index).find(([, record]) => record.path === relative.replace(/\\/g, '/'));

  let id = currentId;
  let wrote = false;
  let nextFrontmatter = { ...(parts.frontmatter || {}) };

  if (id && byPath && byPath[0] !== id) {
    // id no arquivo bate com outro registro: a cópia mais nova troca
    const older = byPath[1].createdAt <= (index[id]?.createdAt || byPath[1].createdAt);
    if (older) {
      id = newNoteId();
      nextFrontmatter.id = id;
      wrote = true;
    }
  }

  if (!id) {
    id = byPath?.[0] || newNoteId();
    nextFrontmatter.id = id;
    wrote = true;
  } else if (!parts.frontmatter || parts.frontmatter.id !== id) {
    nextFrontmatter.id = id;
    wrote = true;
  }

  // Duplicata: dois arquivos com o mesmo id
  const clash = Object.entries(index).find(
    ([storedId, record]) => storedId === id && record.path !== relative.replace(/\\/g, '/'),
  );
  if (clash) {
    const thisStat = fs.statSync(resolveInside(library.root, relative));
    let otherMtime = 0;
    try {
      otherMtime = fs.statSync(resolveInside(library.root, clash[1].path)).mtimeMs;
    } catch {
      otherMtime = 0;
    }
    if (thisStat.mtimeMs >= otherMtime) {
      id = newNoteId();
      nextFrontmatter.id = id;
      wrote = true;
    }
  }

  index[id] = rememberName(
    index[id] || { path: relative, createdAt: new Date().toISOString(), names: [] },
    relative,
  );
  // limpa registro antigo do mesmo caminho com outro id
  for (const [storedId, record] of Object.entries(index)) {
    if (storedId !== id && record.path === relative.replace(/\\/g, '/')) delete index[storedId];
  }
  writeNoteIdIndex(library, index);

  if (!wrote) return { content, id, wrote: false };
  let prefix = parts.prefix;
  if (prefix && !/^id:\s/m.test(prefix) && !/\nid:\s/m.test(prefix)) {
    prefix = prefix.replace(/^---\r?\n/, (open) => `${open}id: ${id}\n`);
  } else if (prefix && currentId && currentId !== id) {
    prefix = prefix.replace(/^id:\s*.+$/m, `id: ${id}`).replace(/\nid:\s*.+/m, `\nid: ${id}`);
  } else if (!prefix) {
    prefix = prefixFromFrontmatter({ id });
  } else {
    prefix = prefixFromFrontmatter(nextFrontmatter);
  }
  const next = composeMarkdown({ bom: parts.bom, prefix, body: parts.body });
  fs.writeFileSync(resolveInside(library.root, relative), next, 'utf8');
  return { content: next, id, wrote: true };
}

export function findNoteByRememberedName(library: Library, name: string) {
  const wanted = name.replace(/\.md$/i, '').trim().toLocaleLowerCase();
  if (!wanted) return null;
  const index = readNoteIdIndex(library);
  const matches = Object.entries(index).filter(([, record]) =>
    record.names.some((item) => item.toLocaleLowerCase() === wanted),
  );
  if (matches.length !== 1) return null;
  const relative = matches[0][1].path;
  try {
    if (fs.existsSync(resolveInside(library.root, relative))) return relative;
  } catch {
    return null;
  }
  return null;
}

export function updateNoteIdPath(library: Library, from: string, to: string) {
  const index = readNoteIdIndex(library);
  let changed = false;
  for (const [id, record] of Object.entries(index)) {
    if (record.path !== from.replace(/\\/g, '/')) continue;
    index[id] = rememberName(record, to);
    changed = true;
  }
  if (changed) writeNoteIdIndex(library, index);
}
