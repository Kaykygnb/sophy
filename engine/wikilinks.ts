export type LinkFormat = 'wiki' | 'embed';

export type ScannedLink = {
  format: LinkFormat;
  raw: string;
  target: string;
  note: string;
  anchor: string;
  alias: string | null;
  start: number;
  end: number;
  targetStart: number;
  targetEnd: number;
};

export type ResolvedPath = {
  path: string | null;
  candidates: string[];
  invalid: boolean;
};

const blank = (value: string) => value.replace(/[^\r\n]/g, ' ');
const norm = (value: string) => value.normalize('NFC').toLocaleLowerCase();

export function parseTarget(target: string) {
  const pipe = target.indexOf('|');
  const destination = (pipe < 0 ? target : target.slice(0, pipe)).trim();
  const hash = destination.indexOf('#');
  return {
    target: destination,
    note: (hash < 0 ? destination : destination.slice(0, hash)).trim(),
    anchor: hash < 0 ? '' : destination.slice(hash + 1),
    alias: pipe < 0 ? null : target.slice(pipe + 1),
  };
}

export function basename(filePath: string) {
  const name = filePath.split('/').pop() ?? filePath;
  return name.replace(/\.md$/i, '');
}

export function labelOf(target: string) {
  const parsed = parseTarget(target);
  if (parsed.alias !== null) return parsed.alias;
  if (parsed.note) return basename(parsed.note) + (parsed.anchor ? ' › ' + parsed.anchor : '');
  return parsed.anchor;
}

/** Esconde frontmatter, comentários HTML e código para o scanner não ver links falsos. */
export function mask(source: string) {
  let result = source.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, (match) =>
    blank(match),
  );
  result = result.replace(/<!--[^]*?-->/g, (match) => blank(match));
  let fence: string | null = null;
  result = result
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
      if (/^(?: {4}|\t)/.test(line) && !/^\s*[-*+\d]/.test(line)) return blank(line);
      return line;
    })
    .join('');
  return result.replace(/(`+)([^]*?)\1/g, (match) => blank(match));
}

export function scan(source: string): ScannedLink[] {
  const masked = mask(source);
  const found: ScannedLink[] = [];
  for (const match of masked.matchAll(/(?<!\\)!\[\[([^\[\]\n]+)\]\]/g)) {
    const inner = match[1];
    const targetStart = match.index + 3;
    found.push({
      ...parseTarget(inner),
      format: 'embed',
      raw: source.slice(match.index, match.index + match[0].length),
      start: match.index,
      end: match.index + match[0].length,
      targetStart,
      targetEnd: targetStart + (inner.includes('|') ? inner.indexOf('|') : inner.length),
    });
  }
  for (const match of masked.matchAll(/(?<!!|\\)\[\[([^\[\]\n]+)\]\]/g)) {
    const inner = match[1];
    const parsed = parseTarget(inner);
    if (!parsed.target) continue;
    const targetStart = match.index + 2;
    found.push({
      ...parsed,
      format: 'wiki',
      raw: source.slice(match.index, match.index + match[0].length),
      start: match.index,
      end: match.index + match[0].length,
      targetStart,
      targetEnd: targetStart + (inner.includes('|') ? inner.indexOf('|') : inner.length),
    });
  }
  return found.sort((a, b) => a.start - b.start);
}

export function headingsOf(source: string) {
  return [...mask(source).matchAll(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map((match) =>
    match[2]
      .replace(/^>\s+/, '')
      .replace(/!?\[\[([^\]]+)\]\]/g, (_, target) => labelOf(target))
      .replace(/[*_`]/g, '')
      .trim(),
  );
}

export function blockIdsOf(source: string) {
  const ids: string[] = [];
  for (const line of mask(source).split(/\r?\n/)) {
    const match = line.match(/(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/);
    if (match) ids.push(match[1]);
  }
  return ids;
}

export function anchorExists(headings: string[], blockIds: string[], anchor: string) {
  if (!anchor) return true;
  if (anchor.startsWith('^')) return blockIds.includes(anchor.slice(1));
  const wanted = norm(anchor);
  return headings.some((heading) => norm(heading) === wanted);
}

/**
 * Nome único em qualquer pasta. Caminho (`Estante/Nota`) escolhe um arquivo.
 * Vários arquivos com o mesmo nome, sem caminho, ficam ambíguos — exceto se
 * houver um na mesma pasta da nota de origem.
 */
export type PathIndex = {
  exact: Map<string, string[]>;
  byBase: Map<string, string[]>;
};

export function indexPaths(paths: string[]): PathIndex {
  const exact = new Map<string, string[]>();
  const byBase = new Map<string, string[]>();
  for (const file of paths) {
    const key = norm(file);
    const same = exact.get(key) ?? [];
    same.push(file);
    exact.set(key, same);
    const base = norm(basename(file));
    const names = byBase.get(base) ?? [];
    names.push(file);
    byBase.set(base, names);
  }
  return { exact, byBase };
}

export function resolvePath(
  note: string,
  source: string,
  paths: string[],
  index?: PathIndex,
): ResolvedPath {
  if (!note) return { path: source, candidates: [source], invalid: false };
  if (/[\\:\x00-\x1f]/.test(note) || note.startsWith('/'))
    return { path: null, candidates: [], invalid: true };
  const suffixed = /\.md$/i.test(note) || hasOtherExtension(note) ? note : note + '.md';
  const folder = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : '';
  const resolvedIndex = index ?? indexPaths(paths);
  const sameFolder = lookup(normalizePath(suffixed, folder), paths, resolvedIndex);
  if (note.includes('/') || sameFolder.length) {
    const found = note.includes('/')
      ? lookup(normalizePath(suffixed, ''), paths, resolvedIndex)
      : sameFolder;
    return {
      path: found.length === 1 ? found[0] : null,
      candidates: found,
      invalid: normalizePath(suffixed, note.includes('/') ? '' : folder) === null,
    };
  }
  const byName = resolvedIndex.byBase.get(norm(basename(note))) ?? [];
  return { path: byName.length === 1 ? byName[0] : null, candidates: byName, invalid: false };
}

export function resolveFile(note: string, source: string, files: string[]): ResolvedPath {
  if (!note) return { path: null, candidates: [], invalid: true };
  const relative = normalizePath(note, note.includes('/') ? '' : '');
  let found = relative === null ? [] : files.filter((file) => norm(file) === norm(relative));
  if (!found.length && !note.includes('/'))
    found = files.filter((file) => norm(file.split('/').pop() ?? '') === norm(note));
  return {
    path: found.length === 1 ? found[0] : null,
    candidates: found,
    invalid: relative === null,
  };
}

function hasOtherExtension(note: string) {
  return /\.[^/]+$/.test(note) && !/\.md$/i.test(note);
}

function lookup(filePath: string | null, paths: string[], index?: PathIndex) {
  if (filePath === null) return [];
  const resolved = index ?? indexPaths(paths);
  return resolved.exact.get(norm(filePath)) ?? [];
}

function normalizePath(filePath: string, base: string) {
  if (/[\x00-\x1f\\:]/.test(filePath) || filePath.startsWith('/')) return null;
  const out = base ? base.split('/').filter(Boolean) : [];
  for (const piece of filePath.split('/')) {
    if (!piece || piece === '.') continue;
    if (piece === '..') {
      if (!out.length) return null;
      out.pop();
    } else {
      if (piece.startsWith('.')) return null;
      out.push(piece);
    }
  }
  return out.join('/');
}

export function plainText(body: string) {
  return body
    .replace(/!\[\[([^\[\]\n]+)\]\]/g, (_, target) => labelOf(target))
    .replace(/\[\[([^\[\]\n]+)\]\]/g, (_, target) => labelOf(target))
    .replace(/^ {0,3}#{1,6}\s+/gm, '')
    .replace(/[*_~`]/g, '');
}
