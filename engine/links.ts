import fs from 'node:fs';
import path from 'node:path';
import { EngineError } from './errors.ts';
import { parseCanvas, serializeCanvas } from './canvas.ts';
import { createdAtFrom, listEntries, listFiles, listNotes, assertEntryMove, moveEntry, readText, type Library } from './library.ts';
import { splitMarkdown } from './markdown.ts';
import { isMother, listChildren, moveMotherTree, registerMother } from './children.ts';
import { findNoteByRememberedName } from './note-id.ts';
import { resolveInside } from './paths.ts';
import { buildRewriteIndexes, rewriteLinks } from './rewrite.ts';
import { fold, rankByFuzzy } from './fuzzy.ts';
import { collectNoteTags, type NoteTag } from './tags.ts';
import {
  findNamedBlock,
  namedBlocksOf,
  previewLines,
  sectionText,
  unwrapWiki,
  type NamedBlock,
} from './blocks.ts';
import {
  anchorExists,
  anchorKey,
  blockIdsOf,
  headingsOf,
  labelOf,
  parseTarget,
  plainText,
  posixPath,
  resolveFile,
  indexPaths,
  resolvePath,
  scan,
  sectionsOf,
  type LinkFormat,
  type NoteSection,
  type ScannedLink,
} from './wikilinks.ts';

export type LinkStatus = 'resolved' | 'ambiguous' | 'broken';

export type LinkKind = 'note' | 'section' | 'block';

export type OutgoingLink = {
  format: LinkFormat;
  raw: string;
  alias: string | null;
  anchor: string;
  display: string;
  status: LinkStatus;
  path: string | null;
  candidates: string[];
  kind?: LinkKind;
};

export type Backlink = {
  from: string;
  raw: string;
  alias: string | null;
  anchor: string;
  display: string;
  format: LinkFormat;
  snippet: string;
};

export type CatalogNote = {
  path: string;
  workspace: string | null;
  title: string;
  aliases: string[];
  headings: string[];
  sections: NoteSection[];
  blockIds: string[];
  blocks: NamedBlock[];
  modifiedAt: number;
  plain: string;
};

type CachedNote = {
  path: string;
  workspace: string | null;
  title: string;
  aliases: string[];
  tags: string[];
  tagRecords: NoteTag[];
  headings: string[];
  sections: NoteSection[];
  blockIds: string[];
  blocks: NamedBlock[];
  plain: string;
  frontmatterText: string;
  mtime: number;
  createdAt: string;
  size: number;
  scanned: ScannedLink[];
  linkSnippets: Map<string, string>;
};

const caches = new Map<string, Map<string, CachedNote>>();
const watchers = new Map<string, fs.FSWatcher>();
const generations = new Map<string, number>();
const bundleByCache = new WeakMap<Map<string, CachedNote>, ReturnType<typeof buildBundle>>();
const fileInventories = new Map<string, string[]>();

export function forgetCachedNote(library: Library, relative: string) {
  caches.get(library.root)?.delete(relative.split('\\').join('/'));
}

export function syncLinks(library: Library) {
  const cache = caches.get(library.root) ?? new Map<string, CachedNote>();
  caches.set(library.root, cache);
  const entries = listEntries(library);
  const notes = entries.filter((file) => file.kind === 'note');
  const canvases = entries.filter((file) => file.kind === 'canvas');
  fileInventories.set(library.root, entries.filter((file) => file.kind !== 'note').map((file) => file.path));
  const seen = new Set<string>();
  for (const note of notes) {
    seen.add(note.path);
    const current = cache.get(note.path);
    if (!current || current.mtime !== note.modifiedAt || current.size !== note.size) {
      try {
        cache.set(
          note.path,
          loadNote(library, note.path, note.workspace, note.modifiedAt, note.size),
        );
      } catch {
        cache.delete(note.path);
      }
    }
  }
  for (const canvas of canvases) {
    seen.add(canvas.path);
    const current = cache.get(canvas.path);
    if (!current || current.mtime !== canvas.modifiedAt || current.size !== canvas.size) {
      try {
        cache.set(
          canvas.path,
          loadCanvas(library, canvas.path, canvas.workspace, canvas.modifiedAt, canvas.size),
        );
      } catch {
        cache.delete(canvas.path);
      }
    }
  }
  for (const cached of cache.keys()) if (!seen.has(cached)) cache.delete(cached);
  bundleByCache.delete(cache);
  return cache;
}

export function outgoingLinks(library: Library, relative: string): OutgoingLink[] {
  return readOutgoing(library, syncLinks(library), relative);
}

export function readOutgoing(
  library: Library,
  cache: Map<string, CachedNote>,
  relative: string,
): OutgoingLink[] {
  const note = cache.get(relative);
  if (!note) throw new EngineError('not-found', 'Nota não encontrada.');
  return decorate(note, cache, library);
}

export function backlinks(library: Library, relative: string): Backlink[] {
  const cache = syncLinks(library);
  if (!cache.has(relative)) throw new EngineError('not-found', 'Nota não encontrada.');
  const found: Backlink[] = [];
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
          snippet: note.linkSnippets.get(link.raw) || link.display,
        });
    }
  }
  return found.sort((a, b) => a.from.localeCompare(b.from, 'pt-BR'));
}

export function catalogNotes(library: Library): CatalogNote[] {
  return [...syncLinks(library).values()]
    .filter((note) => note.path.toLowerCase().endsWith('.md'))
    .map((note) => ({
      path: note.path,
      workspace: note.workspace,
      title: note.title || basename(note.path),
      aliases: note.aliases,
      headings: note.headings,
      sections: note.sections,
      blockIds: note.blockIds,
      blocks: note.blocks,
      modifiedAt: note.mtime,
      plain: note.plain.slice(0, 400),
    }));
}

export function suggestNotes(
  library: Library,
  query: string,
  options: { limit?: number; source?: string } = {},
) {
  const limit = options.limit ?? 12;
  const sourceShelf = options.source?.includes('/')
    ? options.source.slice(0, options.source.indexOf('/'))
    : null;
  const notes = catalogNotes(library);
  const ranked = rankByFuzzy(
    notes,
    query,
    (note) => [note.title, basename(note.path), note.path, ...note.aliases],
    {
      limit: limit + 4,
      recent: (note) => note.modifiedAt,
    },
  );
  return ranked
    .sort((a, b) => {
      const aNear = sourceShelf && a.workspace === sourceShelf ? 0 : 1;
      const bNear = sourceShelf && b.workspace === sourceShelf ? 0 : 1;
      if (aNear !== bNear) return aNear - bNear;
      return b.modifiedAt - a.modifiedAt;
    })
    .slice(0, limit);
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
  assertEntryMove(library, source, target);
  const notes = listNotes(library);
  const files = listFiles(library).map((file) => file.path);
  const notePaths = notes.map((note) => note.path);
  const mapPath = (filePath: string) =>
    filePath === source || filePath.startsWith(source + '/')
      ? target + filePath.slice(source.length)
      : filePath;
  const updated: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const indexes = buildRewriteIndexes(notePaths, files, mapPath);
  const needles = rewriteNeedles(source);
  // Atalho só para rename de nota (.md). Em estante/pasta o basename pode
  // colidir com uma nota homônima e engolir o rewrite de [[Estante/Nota]].
  const uniqueBase =
    /\.md$/i.test(source) &&
    notePaths.filter((file) => basename(file) === basename(source)).length === 1;
  for (const note of notes) {
    try {
      if (
        writeRewritten(library, note.path, (content) => {
          if (!mayNeedRewrite(content, needles)) return content;
          if (uniqueBase) {
            const quick = rewriteUniqueWiki(content, source, target);
            if (quick !== null) return quick;
          }
          return rewriteLinks(content, note.path, notePaths, files, mapPath, indexes);
        })
      )
        updated.push(mapPath(note.path));
    } catch (error) {
      if (error instanceof EngineError && error.code === 'conflict') throw error;
      skipped.push({
        path: note.path,
        reason: error instanceof Error ? error.message : 'falha ao reescrever',
      });
    }
  }
  for (const canvas of listFiles(library).filter((file) => file.kind === 'canvas')) {
    try {
      if (
        writeRewritten(library, canvas.path, (content) => {
          if (!mayNeedRewrite(content, needles)) return content;
          return rewriteCanvas(content, canvas.path, notePaths, files, mapPath, indexes);
        })
      )
        updated.push(mapPath(canvas.path));
    } catch (error) {
      if (error instanceof EngineError && error.code === 'conflict') throw error;
      skipped.push({
        path: canvas.path,
        reason: error instanceof Error ? error.message : 'falha ao reescrever',
      });
    }
  }
  const moved = isMother(library, source)
    ? moveMotherTree(library, source, target)
    : moveEntry(library, source, target);
  const cache = caches.get(library.root);
  if (cache) {
    for (const filePath of [...cache.keys()]) {
      if (filePath === source || filePath.startsWith(source + '/')) cache.delete(filePath);
    }
  }
  return { ...moved, updated, skipped, linksUpdated: updated.length };
}

export function linkGeneration(root: string) {
  return generations.get(root) ?? 0;
}

/** `.sophy` e qualquer segmento oculto ficam fora do vigia. */
export function ignoredByWatch(relative: string) {
  return String(relative)
    .split('\\')
    .join('/')
    .split('/')
    .some((part) => part.startsWith('.'));
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
    if (ignoredByWatch(relative)) return;
    const lower = relative.toLowerCase();
    if (!lower.endsWith('.md') && !lower.endsWith('.canvas')) return;
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
  const sections = sectionsOf(parts.body);
  const scanned = scan(content);
  const tagRecords = collectNoteTags(parts.frontmatter, parts.body);
  return {
    path: relative,
    workspace,
    title: headings[0] || basename(relative),
    aliases: aliasesOf(parts.frontmatter),
    tags: tagRecords.map((tag) => tag.name),
    tagRecords,
    headings,
    sections,
    blockIds: blockIdsOf(parts.body),
    blocks: namedBlocksOf(content),
    plain: plainText(parts.body),
    frontmatterText: frontmatterText(parts.frontmatter),
    mtime,
    createdAt: createdAtFrom(parts.frontmatter, fs.statSync(resolveInside(library.root, relative))),
    size,
    scanned,
    linkSnippets: snippetsFor(content, scanned),
  };
}

const sharedIndexes = new Map<
  string,
  {
    stamp: string;
    index: ReturnType<typeof indexPaths>;
    paths: string[];
    files: string[];
    outgoing: Map<string, OutgoingLink[]>;
  }
>();

function sharedBundle(library: Library, cache: Map<string, CachedNote>) {
  const prepared = bundleByCache.get(cache);
  if (prepared) return prepared;
  const files = fileInventories.get(library.root) || [];
  const stamp = [...cache.values()].map((note) => `${note.path}:${note.mtime}:${note.size}`).join('|') + JSON.stringify(files);
  const current = sharedIndexes.get(library.root);
  const bundle = current && current.stamp === stamp ? current : buildBundle(cache, stamp, files);
  sharedIndexes.set(library.root, bundle);
  bundleByCache.set(cache, bundle);
  return bundle;
}

function buildBundle(cache: Map<string, CachedNote>, stamp: string, files: string[]) {
  const paths = [...cache.keys()];
  const bundle = {
    stamp,
    index: indexPaths(paths),
    paths,
    files,
    outgoing: new Map<string, OutgoingLink[]>(),
  };
  return bundle;
}

function decorate(
  note: CachedNote,
  cache: Map<string, CachedNote>,
  library: Library,
): OutgoingLink[] {
  const bundle = sharedBundle(library, cache);
  const cached = bundle.outgoing.get(note.path);
  if (cached) return cached;
  const paths = bundle.paths;
  const files = bundle.files;
  const index = bundle.index;
  const resolvedLinks = note.scanned.map((link) => {
    const fileLike =
      link.format === 'embed' && /\.[^/]+$/.test(link.note) && !/\.md$/i.test(link.note);
    let resolved = fileLike
      ? resolveFile(link.note, note.path, files)
      : resolvePath(link.note, note.path, paths, index);
    if (!fileLike && !resolved.path && resolved.candidates.length === 0) {
      const healed = findNoteByRememberedName(library, link.note);
      if (healed) resolved = { path: healed, candidates: [healed], invalid: false };
    }
    let status: LinkStatus = 'broken';
    const target = resolved.path ? cache.get(resolved.path) : undefined;
    if (resolved.invalid || (!resolved.path && resolved.candidates.length === 0)) status = 'broken';
    else if (!resolved.path) status = 'ambiguous';
    else {
      const anchorOk = !link.anchor
        ? true
        : target
          ? anchorExists(
              target.headings,
              target.blockIds,
              link.anchor,
              target.blocks.map((block) => block.title),
            )
          : false;
      status = anchorOk ? 'resolved' : 'broken';
    }
    const kind = status === 'resolved' && target ? linkKind(target, link.anchor) : undefined;
    return {
      format: link.format,
      raw: link.raw,
      alias: link.alias,
      anchor: link.anchor,
      display: link.alias ?? labelOf(link.target),
      status,
      path: status === 'resolved' ? resolved.path : null,
      candidates: resolved.candidates,
      ...(kind ? { kind } : {}),
    };
  });
  bundle.outgoing.set(note.path, resolvedLinks);
  return resolvedLinks;
}

function aliasesOf(frontmatter: Record<string, unknown> | null) {
  if (!frontmatter) return [];
  const raw = frontmatter.aliases ?? frontmatter.alias;
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string');
  return [];
}

function snippetAround(body: string, raw: string) {
  const source = String(body || '');
  const at = source.indexOf(raw);
  if (at < 0) {
    const line = source.split(/\r?\n/).find((row) => row.includes(raw.replace(/^!?\[\[|\]\]$/g, '')));
    return clipSnippet(line || source.slice(0, 120));
  }
  const start = Math.max(0, source.lastIndexOf('\n', at - 1) + 1);
  const end = source.indexOf('\n', at + raw.length);
  return clipSnippet(source.slice(start, end < 0 ? undefined : end));
}

function clipSnippet(line: string) {
  const clean = line
    .replace(/!?\[\[[^\[\]\n]+\]\]/g, (match) => labelOf(match.replace(/^!?\[\[|\]\]$/g, '')))
    .replace(/[*_`#>-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= 140) return clean;
  return `${clean.slice(0, 137)}…`;
}

export { fold };

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

function loadCanvas(
  library: Library,
  relative: string,
  workspace: string | null,
  mtime: number,
  size: number,
): CachedNote {
  const content = readText(library, relative).content;
  const file = parseCanvas(content);
  const scanned: ScannedLink[] = [];
  const texts: string[] = [];
  for (const node of file.nodes) {
    if (node.type === 'text' && typeof node.text === 'string') {
      texts.push(node.text);
      scanned.push(...scan(node.text));
    }
    if (node.type === 'file' && typeof node.file === 'string' && node.file.trim())
      scanned.push(fileNodeLink(node.file));
  }
  return {
    path: relative,
    workspace,
    title: basename(relative),
    aliases: [],
    tags: [],
    tagRecords: [],
    headings: [],
    sections: [],
    blockIds: [],
    blocks: [],
    plain: plainText(texts.join('\n')),
    frontmatterText: '',
    mtime,
    createdAt: createdAtFrom(null, fs.statSync(resolveInside(library.root, relative))),
    size,
    scanned,
    linkSnippets: snippetsFor(texts.join('\n'), scanned),
  };
}

function fileNodeLink(file: string): ScannedLink {
  const note = file.replace(/\.md$/i, '');
  return {
    format: 'wiki',
    raw: `[[${note}]]`,
    target: note,
    note,
    anchor: '',
    alias: null,
    start: 0,
    end: 0,
    targetStart: 0,
    targetEnd: 0,
  };
}

function rewriteCanvas(
  content: string,
  source: string,
  notePaths: string[],
  filePaths: string[],
  mapPath: (filePath: string) => string,
  indexes?: ReturnType<typeof buildRewriteIndexes>,
) {
  let file;
  try {
    file = parseCanvas(content);
  } catch {
    return content;
  }
  let changed = false;
  for (const node of file.nodes) {
    if (node.type === 'text' && typeof node.text === 'string') {
      const next = rewriteLinks(node.text, source, notePaths, filePaths, mapPath, indexes);
      if (next !== node.text) {
        node.text = next;
        changed = true;
      }
    }
    if (node.type === 'file' && typeof node.file === 'string') {
      const next = rewriteFileRef(node.file, notePaths, filePaths, mapPath);
      if (next !== node.file) {
        node.file = next;
        changed = true;
      }
    }
  }
  return changed ? serializeCanvas(file) : content;
}

function rewriteNeedles(source: string) {
  const base = basename(source);
  const stem = source.replace(/\.md$/i, '').replace(/\.canvas$/i, '');
  return [source, stem, base, `[[${base}`, `[[${stem}`, `/${base}`, `"${source}"`, `"${stem}"`];
}

function mayNeedRewrite(content: string, needles: string[]) {
  return needles.some((needle) => content.includes(needle));
}

/** Uma leitura + escrita direta, sem triplo SHA-256 do writeText. */
function writeRewritten(library: Library, relative: string, transform: (content: string) => string) {
  const full = resolveInside(library.root, relative);
  const before = fs.statSync(full);
  const original = fs.readFileSync(full, 'utf8');
  const next = transform(original);
  if (next === original) return false;
  const after = fs.statSync(full);
  if (after.mtimeMs !== before.mtimeMs || after.size !== before.size)
    throw new EngineError('conflict', 'O arquivo mudou durante a reescrita dos links.');
  fs.writeFileSync(full, next);
  return true;
}

function snippetsFor(content: string, scanned: ScannedLink[]) {
  const map = new Map<string, string>();
  for (const link of scanned) map.set(link.raw, snippetAround(content, link.raw));
  return map;
}

/** Atalho seguro só para notas: nome-base único, respeitando código via scan. */
function rewriteUniqueWiki(content: string, source: string, target: string) {
  const fromStem = source.replace(/\.md$/i, '');
  const toStem = target.replace(/\.md$/i, '');
  if (!fromStem || fromStem === toStem) return null;
  return rewriteLinks(content, source, [source], [], (filePath) =>
    filePath === source ? target : filePath,
  );
}

function rewriteFileRef(
  file: string,
  notePaths: string[],
  filePaths: string[],
  mapPath: (filePath: string) => string,
) {
  const pool = [...notePaths, ...filePaths];
  const match = pool.find(
    (item) => item === file || item === `${file}.md` || item.replace(/\.md$/i, '') === file,
  );
  if (!match) return file;
  const next = mapPath(match);
  if (next === match) return file;
  if (/\.md$/i.test(file)) return /\.md$/i.test(next) ? next : `${next}.md`;
  if (/\.[^/]+$/i.test(file)) return next;
  return next.replace(/\.md$/i, '');
}

function basename(filePath: string) {
  return (filePath.split('/').pop() ?? filePath).replace(/\.md$/i, '').replace(/\.canvas$/i, '');
}

function linkKind(note: CachedNote, anchor: string): LinkKind {
  if (!anchor) return 'note';
  if (anchor.startsWith('^')) return 'block';
  const wanted = anchorKey(anchor);
  if (note.headings.some((heading) => anchorKey(heading) === wanted)) return 'section';
  return 'block';
}

/** Tira do índice as notas regravadas, para o próximo scan ler o disco. */
export function forgetLinks(library: Library, paths: string[]) {
  const cache = caches.get(library.root);
  if (cache) {
    for (const filePath of paths) cache.delete(posixPath(filePath));
    bundleByCache.delete(cache);
  }
  sharedIndexes.delete(library.root);
}

export function scanBlocks(library: Library, relative?: string) {
  const cache = syncLinks(library);
  const present = (note: CachedNote) => ({ path: note.path, blocks: note.blocks });
  if (relative === undefined) {
    return [...cache.values()]
      .filter((note) => note.path.toLowerCase().endsWith('.md'))
      .map(present)
      .sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'));
  }
  const key = posixPath(relative);
  const note = cache.get(key);
  if (!note || !key.toLowerCase().endsWith('.md'))
    throw new EngineError('not-found', 'Nota não encontrada.');
  return present(note);
}

export function resolveLink(library: Library, source: string, rawTarget: string) {
  const from = posixPath(source);
  const cache = syncLinks(library);
  if (!cache.has(from) || !from.toLowerCase().endsWith('.md'))
    throw new EngineError('not-found', 'Nota não encontrada.');
  const spec = parseTarget(unwrapWiki(rawTarget));
  const paths = [...cache.keys()];
  let resolved = resolvePath(spec.note, from, paths);
  if (!resolved.invalid && !resolved.path && resolved.candidates.length === 0) {
    const healed = findNoteByRememberedName(library, spec.note);
    if (healed) resolved = { path: healed, candidates: [healed], invalid: false };
  }
  if (resolved.invalid || !resolved.path) return { ...spec, ...resolved };
  const target = cache.get(resolved.path);
  if (!spec.anchor) {
    return {
      kind: 'note' as const,
      ...spec,
      path: resolved.path,
      notePath: resolved.path,
      title: target?.title || basename(resolved.path),
      candidates: resolved.candidates,
      invalid: false,
    };
  }
  if (!target) return { ...spec, path: null, candidates: resolved.candidates, invalid: false };
  const wanted = anchorKey(spec.anchor);
  if (!spec.anchor.startsWith('^') && target.headings.some((heading) => anchorKey(heading) === wanted)) {
    const title = target.headings.find((heading) => anchorKey(heading) === wanted) || spec.anchor;
    return {
      kind: 'section' as const,
      ...spec,
      path: resolved.path,
      notePath: resolved.path,
      title,
      candidates: resolved.candidates,
      invalid: false,
    };
  }
  if (spec.anchor.startsWith('^')) {
    if (!target.blockIds.includes(spec.anchor.slice(1)))
      return { ...spec, path: null, candidates: resolved.candidates, invalid: false };
    const located = caretLine(readText(library, resolved.path).content, spec.anchor.slice(1));
    return {
      kind: 'block' as const,
      notePath: resolved.path,
      anchor: spec.anchor,
      title: spec.anchor.slice(1),
      lang: '',
      startLine: located.line,
      endLine: located.line,
      preview: located.text,
      truncated: false,
      path: resolved.path,
      ...spec,
      candidates: resolved.candidates,
      invalid: false,
    };
  }
  const block = target.blocks.find((item) => anchorKey(item.title) === wanted && !item.duplicate);
  if (!block) return { ...spec, path: null, candidates: resolved.candidates, invalid: false };
  const content = readText(library, resolved.path).content;
  const rich = findNamedBlock(content, spec.anchor);
  const code = rich?.code ?? '';
  const shown = previewLines(code);
  return {
    kind: 'block' as const,
    notePath: resolved.path,
    anchor: spec.anchor,
    title: block.title,
    lang: block.lang,
    startLine: block.startLine,
    endLine: block.endLine,
    preview: shown.preview,
    truncated: shown.truncated,
    path: resolved.path,
    candidates: resolved.candidates,
    invalid: false,
  };
}

export function previewLink(library: Library, source: string, rawTarget: string) {
  const resolved = resolveLink(library, source, rawTarget);
  if (!('kind' in resolved) || !resolved.kind) return resolved;
  if (resolved.kind === 'block') {
    if (resolved.anchor.startsWith('^'))
      return { kind: 'block' as const, lang: '', title: resolved.title, code: resolved.preview };
    const content = readText(library, resolved.notePath).content;
    const rich = findNamedBlock(content, resolved.anchor);
    return { kind: 'block' as const, lang: resolved.lang, title: resolved.title, code: rich?.code ?? '' };
  }
  const content = readText(library, resolved.notePath).content;
  if (resolved.kind === 'section') {
    const body = splitMarkdown(content).body;
    return {
      kind: 'section' as const,
      notePath: resolved.notePath,
      anchor: resolved.anchor,
      title: resolved.title,
      text: sectionText(body, resolved.anchor),
    };
  }
  return {
    kind: 'note' as const,
    notePath: resolved.notePath,
    anchor: resolved.anchor,
    title: resolved.title,
    text: splitMarkdown(content).body,
  };
}

function caretLine(source: string, id: string) {
  const lines = source.split(/\r?\n/);
  const pattern = new RegExp(`(?:^|\\s)\\^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) return { line: index + 1, text: lines[index].trim() };
  }
  return { line: 1, text: '' };
}
