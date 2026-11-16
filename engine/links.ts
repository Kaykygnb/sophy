import fs from 'node:fs';
import path from 'node:path';
import { EngineError } from './errors.ts';
import { listFiles, listNotes, moveEntry, readText, writeText, type Library } from './library.ts';
import { splitMarkdown } from './markdown.ts';
import { rewriteLinks } from './rewrite.ts';
import {
  anchorExists,
  blockIdsOf,
  headingsOf,
  labelOf,
  plainText,
  resolveFile,
  resolvePath,
  scan,
  type LinkFormat,
  type ScannedLink,
} from './wikilinks.ts';

export type LinkStatus = 'resolved' | 'ambiguous' | 'broken';

export type OutgoingLink = {
  format: LinkFormat;
  raw: string;
  alias: string | null;
  anchor: string;
  display: string;
  status: LinkStatus;
  path: string | null;
  candidates: string[];
};

type CachedNote = {
  path: string;
  workspace: string | null;
  title: string;
  tags: string[];
  headings: string[];
  blockIds: string[];
  plain: string;
  frontmatterText: string;
  mtime: number;
  size: number;
  scanned: ScannedLink[];
};

const caches = new Map<string, Map<string, CachedNote>>();
const watchers = new Map<string, fs.FSWatcher>();
const generations = new Map<string, number>();

export function syncLinks(library: Library) {
  const cache = caches.get(library.root) ?? new Map<string, CachedNote>();
  caches.set(library.root, cache);
  const notes = listNotes(library);
  const seen = new Set<string>();
  for (const note of notes) {
    seen.add(note.path);
    const current = cache.get(note.path);
    if (!current || current.mtime !== note.modifiedAt || current.size !== note.size)
      cache.set(
        note.path,
        loadNote(library, note.path, note.workspace, note.modifiedAt, note.size),
      );
  }
  for (const cached of cache.keys()) if (!seen.has(cached)) cache.delete(cached);
  return cache;
}

export function outgoingLinks(library: Library, relative: string): OutgoingLink[] {
  const cache = syncLinks(library);
  const note = cache.get(relative);
  if (!note) throw new EngineError('not-found', 'Nota não encontrada.');
  return decorate(note, cache, library);
}

export function backlinks(library: Library, relative: string) {
  const cache = syncLinks(library);
  if (!cache.has(relative)) throw new EngineError('not-found', 'Nota não encontrada.');
  const found = [];
  for (const note of cache.values()) {
    for (const link of decorate(note, cache, library)) {
      if (link.status === 'resolved' && link.path === relative)
        found.push({
          from: note.path,
          raw: link.raw,
          alias: link.alias,
          anchor: link.anchor,
          display: link.display,
          format: link.format,
        });
    }
  }
  return found.sort((a, b) => a.from.localeCompare(b.from, 'pt-BR'));
}

export function brokenLinks(library: Library) {
  const cache = syncLinks(library);
  const found = [];
  for (const note of cache.values()) {
    for (const link of decorate(note, cache, library)) {
      if (link.status === 'resolved') continue;
      found.push({
        from: note.path,
        raw: link.raw,
        status: link.status,
        candidates: link.candidates,
      });
    }
  }
  return found;
}

export function indexedNotes(library: Library) {
  return [...syncLinks(library).values()];
}

export function relocate(library: Library, source: string, target: string) {
  const notes = listNotes(library);
  const files = listFiles(library).map((file) => file.path);
  const notePaths = notes.map((note) => note.path);
  const mapPath = (filePath: string) =>
    filePath === source || filePath.startsWith(source + '/')
      ? target + filePath.slice(source.length)
      : filePath;
  const updated: string[] = [];
  for (const note of notes) {
    const doc = readText(library, note.path);
    const next = rewriteLinks(doc.content, note.path, notePaths, files, mapPath);
    if (next === doc.content) continue;
    const written = writeText(library, note.path, next, doc.revision);
    if (written.conflict)
      throw new EngineError('conflict', 'O arquivo mudou durante a reescrita dos links.');
    updated.push(mapPath(note.path));
  }
  const moved = moveEntry(library, source, target);
  const cache = caches.get(library.root);
  if (cache) {
    for (const filePath of [...cache.keys()]) {
      if (filePath === source || filePath.startsWith(source + '/')) cache.delete(filePath);
    }
  }
  return { ...moved, updated };
}

export function linkGeneration(root: string) {
  return generations.get(root) ?? 0;
}

export function watchLibrary(library: Library, enabled: boolean) {
  const current = watchers.get(library.root);
  if (!enabled) {
    current?.close();
    watchers.delete(library.root);
    return { watching: false };
  }
  if (current) return { watching: true };
  syncLinks(library);
  const watcher = fs.watch(library.root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const relative = String(filename).split(path.sep).join('/');
    if (relative.split('/').some((part) => part.startsWith('.'))) return;
    if (!relative.toLowerCase().endsWith('.md')) return;
    caches.get(library.root)?.delete(relative);
    generations.set(library.root, (generations.get(library.root) ?? 0) + 1);
  });
  watchers.set(library.root, watcher);
  return { watching: true };
}

function loadNote(
  library: Library,
  relative: string,
  workspace: string | null,
  mtime: number,
  size: number,
): CachedNote {
  const content = readText(library, relative).content;
  const parts = splitMarkdown(content);
  const headings = headingsOf(parts.body);
  return {
    path: relative,
    workspace,
    title: headings[0] || basename(relative),
    tags: tagsOf(parts.frontmatter),
    headings,
    blockIds: blockIdsOf(parts.body),
    plain: plainText(parts.body),
    frontmatterText: frontmatterText(parts.frontmatter),
    mtime,
    size,
    scanned: scan(content),
  };
}

function decorate(
  note: CachedNote,
  cache: Map<string, CachedNote>,
  library: Library,
): OutgoingLink[] {
  const notePaths = [...cache.keys()];
  const files = listFiles(library).map((file) => file.path);
  return note.scanned.map((link) => {
    const fileLike =
      link.format === 'embed' && /\.[^/]+$/.test(link.note) && !/\.md$/i.test(link.note);
    const resolved = fileLike
      ? resolveFile(link.note, note.path, files)
      : resolvePath(link.note, note.path, notePaths);
    let status: LinkStatus = 'broken';
    if (resolved.invalid || (!resolved.path && resolved.candidates.length === 0)) status = 'broken';
    else if (!resolved.path) status = 'ambiguous';
    else {
      const target = cache.get(resolved.path);
      const anchorOk = !link.anchor
        ? true
        : target
          ? anchorExists(target.headings, target.blockIds, link.anchor)
          : false;
      status = anchorOk ? 'resolved' : 'broken';
    }
    return {
      format: link.format,
      raw: link.raw,
      alias: link.alias,
      anchor: link.anchor,
      display: link.alias ?? labelOf(link.target),
      status,
      path: status === 'resolved' ? resolved.path : null,
      candidates: resolved.candidates,
    };
  });
}

function tagsOf(frontmatter: Record<string, unknown> | null) {
  const tags = frontmatter?.tags;
  if (typeof tags === 'string') return [tags];
  if (Array.isArray(tags)) return tags.filter((tag): tag is string => typeof tag === 'string');
  return [];
}

function frontmatterText(frontmatter: Record<string, unknown> | null) {
  if (!frontmatter) return '';
  const values: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      values.push(String(value));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(frontmatter);
  return values.join('\n');
}

function basename(filePath: string) {
  return (filePath.split('/').pop() ?? filePath).replace(/\.md$/i, '');
}
