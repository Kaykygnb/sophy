import { EngineError } from './errors.ts';
import { readText, writeText, type Library } from './library.ts';
import { composeMarkdown, prefixFromFrontmatter, splitMarkdown } from './markdown.ts';

/**
 * Tags no texto (`#nome`) e no frontmatter (`tags:`).
 * A chave é minúscula, com acento. A grafia exibida é a da primeira ocorrência.
 */

export type TagSource = 'text' | 'frontmatter' | 'both';

export type NoteTag = {
  key: string;
  name: string;
  source: TagSource;
};

export type TagNoteRecord = {
  path: string;
  title: string;
  mtime: number;
  tagRecords: NoteTag[];
};

export type TagNode = {
  name: string;
  path: string;
  count: number;
  total: number;
  children: TagNode[];
};

export type TagFilter = {
  tag?: string;
  tags?: string[];
  tagsMode?: 'any' | 'all';
};

const TAG_BODY = /[\p{L}0-9_-]/u;
const VALID_TAG = /^[\p{L}0-9_-]+(?:\/[\p{L}0-9_-]+)*$/u;
const NON_DIGIT = /[\p{L}_-]/u;
const OPENING = /[\p{Ps}\p{Pi}"']/u;

export function tagKey(name: string) {
  return name.normalize('NFC').toLocaleLowerCase('pt-BR');
}

/** Aceita `#` inicial e barra final. Rejeita `#123` e nome vazio. */
export function cleanTag(input: string) {
  let raw = input.normalize('NFC').trim();
  if (raw.startsWith('#')) raw = raw.slice(1).trim();
  while (raw.endsWith('/')) raw = raw.slice(0, -1);
  if (!raw || !isValidTag(raw)) return null;
  return raw;
}

export function portablePath(value: string) {
  return value.split('\\').join('/');
}

export function collectNoteTags(frontmatter: Record<string, unknown> | null, body: string): NoteTag[] {
  const map = new Map<string, NoteTag>();
  const add = (name: string, source: 'text' | 'frontmatter') => {
    const key = tagKey(name);
    const current = map.get(key);
    if (!current) {
      map.set(key, { key, name, source });
      return;
    }
    if (current.source !== source) current.source = 'both';
  };
  for (const name of frontmatterTagNames(frontmatter)) add(name, 'frontmatter');
  for (const tag of findBodyTags(body)) add(tag.name, 'text');
  return [...map.values()];
}

export function matchesTagFilter(records: NoteTag[] | undefined, filter: TagFilter = {}) {
  const requested = [...(filter.tags ?? [])];
  if (filter.tag) requested.push(filter.tag);
  if (!requested.length) return true;
  const cleaned = requested.map((item) => cleanTag(item));
  if (filter.tagsMode === 'all') {
    if (cleaned.some((item) => !item)) return false;
    return cleaned.every((item) => hasTag(records, tagKey(item as string)));
  }
  const valid = cleaned.filter((item): item is string => Boolean(item));
  if (!valid.length) return false;
  return valid.some((item) => hasTag(records, tagKey(item)));
}

export function listTagTree(records: TagNoteRecord[]) {
  const index = buildIndex(records);
  const tags = directChildren(index, null)
    .map((key) => nodeOf(index, key))
    .sort(byTotalThenName);
  return { tags };
}

export function listNotesForTag(records: TagNoteRecord[], tag: string, nested = true) {
  const name = cleanTag(tag);
  if (!name) throw new EngineError('tag_invalida', 'A tag é inválida.');
  const key = tagKey(name);
  const index = buildIndex(records);
  const notes = [...index.notes.values()]
    .flatMap((note) => {
      const source = matchSource(note.tagRecords, key, nested);
      if (!source) return [];
      return [{ path: note.path, title: note.title, mtime: note.mtime, source }];
    })
    .sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'));
  return { notes };
}

export function suggestTags(records: TagNoteRecord[], prefix = '', limit = 10) {
  const index = buildIndex(records);
  const needle = normalizePrefix(prefix);
  const tags = [...index.display.entries()]
    .map(([key, name]) => ({ name, total: totalOf(index, key) }))
    .filter((tag) => !needle || tagKey(tag.name).startsWith(needle))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'pt-BR'));
  return { tags: tags.slice(0, limit) };
}

export function readStoredTags(library: Library, relative: string) {
  const file = readText(library, relative);
  const parts = splitMarkdown(file.content);
  if (parts.frontmatterError) throw new EngineError('invalid-note', 'O frontmatter não pôde ser lido.');
  return dedupeNames(frontmatterTagNames(parts.frontmatter));
}

export function editStoredTags(library: Library, relative: string, add: string[], remove: string[]) {
  for (const item of [...add, ...remove]) {
    if (!cleanTag(item)) throw new EngineError('tag_invalida', 'A tag é inválida.');
  }
  const file = readText(library, relative);
  const edited = editTagContent(file.content, add, remove);
  if (!edited.changed) return { tags: edited.tags };
  const written = writeText(library, relative, edited.content, file.revision);
  if (written.conflict) throw new EngineError('conflict', 'A nota mudou durante a edição das tags.');
  return { tags: edited.tags };
}

export function renameTags(library: Library, from: string, to: string, notes: TagNoteRecord[]) {
  const fromName = cleanTag(from);
  const toName = cleanTag(to);
  if (!fromName || !toName) throw new EngineError('tag_invalida', 'A tag é inválida.');
  const fromKey = tagKey(fromName);
  const targets = notes.filter((note) =>
    note.tagRecords.some((tag) => tag.key === fromKey || tag.key.startsWith(fromKey + '/')),
  );
  if (!targets.length) throw new EngineError('tag_inexistente', 'A tag não existe.');
  if (fromName === toName) return { changedNotes: 0, replaced: 0, paths: [] as string[] };
  let changedNotes = 0;
  let replaced = 0;
  const paths: string[] = [];
  for (const note of targets) {
    const file = readText(library, note.path);
    const result = rewriteNoteTags(file.content, fromKey, toName);
    if (!result.replaced || result.content === file.content) continue;
    const written = writeText(library, note.path, result.content, file.revision);
    if (written.conflict) throw new EngineError('conflict', 'A nota mudou durante a renomeação da tag.');
    changedNotes += 1;
    replaced += result.replaced;
    paths.push(note.path);
  }
  return { changedNotes, replaced, paths };
}

function editTagContent(content: string, add: string[], remove: string[]) {
  const parts = splitMarkdown(content);
  if (parts.frontmatterError) throw new EngineError('invalid-note', 'O frontmatter não pôde ser lido.');
  const current = dedupeNames(frontmatterTagNames(parts.frontmatter));
  const removeKeys = new Set(remove.map((item) => tagKey(cleanTag(item) as string)));
  const next: string[] = [];
  const seen = new Set<string>();
  for (const name of current) {
    const key = tagKey(name);
    if (removeKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    next.push(name);
  }
  for (const item of add) {
    const name = cleanTag(item) as string;
    const key = tagKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(name);
  }
  if (sameList(current, next)) return { content, tags: current, changed: false };
  const matter = { ...(parts.frontmatter || {}) };
  if (next.length === 0) delete matter.tags;
  else matter.tags = next;
  return {
    content: composeMarkdown({
      bom: parts.bom,
      prefix: prefixFromFrontmatter(matter),
      body: parts.body,
    }),
    tags: next,
    changed: true,
  };
}

function rewriteNoteTags(content: string, fromKey: string, toName: string) {
  const parts = splitMarkdown(content);
  const body = rewriteBody(parts.body, fromKey, toName);
  let replaced = body.replaced;
  let prefix = parts.prefix;
  if (parts.frontmatter && !parts.frontmatterError) {
    const current = dedupeNames(frontmatterTagNames(parts.frontmatter));
    const next: string[] = [];
    const seen = new Set<string>();
    let frontmatterReplaced = 0;
    for (const name of current) {
      const key = tagKey(name);
      let written = name;
      if (key === fromKey || key.startsWith(fromKey + '/')) {
        written = renamedTag(name, fromKey, toName);
        if (written !== name) frontmatterReplaced += 1;
      }
      const writtenKey = tagKey(written);
      if (seen.has(writtenKey)) continue;
      seen.add(writtenKey);
      next.push(written);
    }
    if (frontmatterReplaced > 0 || !sameList(current, next)) {
      replaced += frontmatterReplaced;
      const matter = { ...parts.frontmatter };
      if (next.length === 0) delete matter.tags;
      else matter.tags = next;
      prefix = prefixFromFrontmatter(matter);
    }
  }
  if (!replaced) return { content, replaced: 0 };
  return {
    content: composeMarkdown({ bom: parts.bom, prefix, body: body.body }),
    replaced,
  };
}

function rewriteBody(body: string, fromKey: string, toName: string) {
  const tags = findBodyTags(body).flatMap((tag) => {
    const key = tagKey(tag.name);
    if (key !== fromKey && !key.startsWith(fromKey + '/')) return [];
    const next = renamedTag(tag.name, fromKey, toName);
    if (next === tag.name) return [];
    return [{ ...tag, next }];
  });
  if (!tags.length) return { body, replaced: 0 };
  let next = body;
  for (let index = tags.length - 1; index >= 0; index -= 1) {
    const tag = tags[index];
    next = next.slice(0, tag.start) + tag.next + next.slice(tag.end);
  }
  return { body: next, replaced: tags.length };
}

function renamedTag(original: string, fromKey: string, toName: string) {
  const suffix = original.split('/').slice(fromKey.split('/').length).join('/');
  return suffix ? `${toName}/${suffix}` : toName;
}

function findBodyTags(body: string) {
  const masked = maskTagRegions(body);
  const found: Array<{ name: string; start: number; end: number }> = [];
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] !== '#') continue;
    if (!isTagBoundary(masked, index)) continue;
    const span = readTag(masked, index);
    if (!span) continue;
    const raw = body.slice(span.start, span.end);
    if (raw !== masked.slice(span.start, span.end)) continue;
    const name = raw.normalize('NFC');
    if (!isValidTag(name)) continue;
    found.push({ name, start: span.start, end: span.end });
    index = span.end - 1;
  }
  return found;
}

function readTag(text: string, hash: number) {
  const start = hash + 1;
  let index = start;
  let segment = 0;
  let end = start;
  while (index < text.length) {
    const char = text[index];
    if (char === '/') {
      if (segment === 0) break;
      index += 1;
      segment = 0;
      continue;
    }
    if (!TAG_BODY.test(char)) break;
    segment += 1;
    index += 1;
    end = index;
  }
  if (end === start) return null;
  return { start, end };
}

function isTagBoundary(text: string, index: number) {
  if (index === 0) return true;
  const previous = text[index - 1];
  return /\s/u.test(previous) || OPENING.test(previous);
}

function isValidTag(raw: string) {
  return VALID_TAG.test(raw) && NON_DIGIT.test(raw);
}

function maskTagRegions(body: string) {
  return blankUrls(blankMarkdownLinks(blankWikilinks(blankHtml(blankInline(blankFences(body))))));
}

function blankFences(source: string) {
  let fence: string | null = null;
  return source
    .split(/(?<=\n)/)
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fence) {
        const closed = marker && marker[1][0] === fence[0] && marker[1].length >= fence.length;
        const hidden = blank(line);
        if (closed) fence = null;
        return hidden;
      }
      if (marker) {
        fence = marker[1];
        return blank(line);
      }
      return line;
    })
    .join('');
}

function blankInline(source: string) {
  return source.replace(/(`+)([^`]*?)\1/g, (match) => blank(match));
}

function blankHtml(source: string) {
  return source.replace(/<\/?[A-Za-z][^>\n]*>/g, (match) => blank(match));
}

function blankWikilinks(source: string) {
  return source.replace(/!?\[\[[^\[\]\n]*\]\]/g, (match) => blank(match));
}

function blankMarkdownLinks(source: string) {
  return source
    .replace(/!?\[[^\[\]\n]*\]\([^)\n]*\)/g, (match) => blank(match))
    .replace(/!?\[[^\[\]\n]*\]\[[^\[\]\n]*\]/g, (match) => blank(match))
    .replace(/<(?:https?:\/\/|mailto:)[^>\s]+>/gi, (match) => blank(match));
}

function blankUrls(source: string) {
  return source.replace(/\b(?:https?:\/\/|www\.)[^\s<]+/gi, (match) => blank(match));
}

function blank(value: string) {
  return value.replace(/[^\r\n]/g, ' ');
}

function frontmatterTagNames(frontmatter: Record<string, unknown> | null | undefined) {
  if (!frontmatter) return [];
  const raw = frontmatter.tags;
  const tokens: string[] = [];
  const take = (value: unknown) => {
    if (typeof value !== 'string') return;
    tokens.push(...value.split(/[,\s]+/u).filter(Boolean));
  };
  if (Array.isArray(raw)) raw.forEach(take);
  else take(raw);
  const names: string[] = [];
  for (const token of tokens) {
    const name = cleanTag(token);
    if (name) names.push(name);
  }
  return names;
}

function dedupeNames(names: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    const key = tagKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique;
}

function sameList(left: string[], right: string[]) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function hasTag(records: NoteTag[] | undefined, key: string) {
  return (records ?? []).some((tag) => tag.key === key || tag.key.startsWith(key + '/'));
}

function normalizePrefix(prefix: string) {
  let raw = prefix.normalize('NFC').trim().toLocaleLowerCase('pt-BR');
  if (raw.startsWith('#')) raw = raw.slice(1).trim();
  return raw;
}

type TagIndex = {
  display: Map<string, string>;
  exact: Map<string, Set<string>>;
  notes: Map<string, TagNoteRecord>;
};

function buildIndex(records: TagNoteRecord[]): TagIndex {
  const display = new Map<string, string>();
  const exact = new Map<string, Set<string>>();
  const notes = new Map<string, TagNoteRecord>();
  const remember = (name: string) => {
    const parts = name.split('/');
    const acc: string[] = [];
    for (const part of parts) {
      acc.push(part);
      const full = acc.join('/');
      const key = tagKey(full);
      if (!display.has(key)) display.set(key, full);
    }
  };
  const ordered = [...records].sort((a, b) =>
    portablePath(a.path).localeCompare(portablePath(b.path), 'pt-BR'),
  );
  for (const note of ordered) {
    const path = portablePath(note.path);
    notes.set(path, { ...note, path });
    for (const tag of note.tagRecords) {
      remember(tag.name);
      const bucket = exact.get(tag.key) ?? new Set<string>();
      bucket.add(path);
      exact.set(tag.key, bucket);
    }
  }
  return { display, exact, notes };
}

function directChildren(index: TagIndex, parent: string | null) {
  const depth = parent ? parent.split('/').length + 1 : 1;
  const prefix = parent ? parent + '/' : '';
  const keys: string[] = [];
  for (const key of index.display.keys()) {
    if (parent && !key.startsWith(prefix)) continue;
    if (key.split('/').length === depth) keys.push(key);
  }
  return keys;
}

function totalOf(index: TagIndex, key: string) {
  const paths = new Set<string>();
  for (const [candidate, bucket] of index.exact) {
    if (candidate !== key && !candidate.startsWith(key + '/')) continue;
    for (const path of bucket) paths.add(path);
  }
  return paths.size;
}

function nodeOf(index: TagIndex, key: string): TagNode {
  const full = index.display.get(key) ?? key;
  const children = directChildren(index, key)
    .map((child) => nodeOf(index, child))
    .sort(byTotalThenName);
  return {
    name: full.split('/').pop() ?? full,
    path: full,
    count: index.exact.get(key)?.size ?? 0,
    total: totalOf(index, key),
    children,
  };
}

function byTotalThenName(a: TagNode, b: TagNode) {
  if (a.total !== b.total) return b.total - a.total;
  return a.name.localeCompare(b.name, 'pt-BR');
}

function matchSource(records: NoteTag[], key: string, nested: boolean): TagSource | null {
  let text = false;
  let frontmatter = false;
  for (const tag of records) {
    const hit = tag.key === key || (nested && tag.key.startsWith(key + '/'));
    if (!hit) continue;
    if (tag.source === 'text' || tag.source === 'both') text = true;
    if (tag.source === 'frontmatter' || tag.source === 'both') frontmatter = true;
  }
  if (text && frontmatter) return 'both';
  if (text) return 'text';
  if (frontmatter) return 'frontmatter';
  return null;
}
