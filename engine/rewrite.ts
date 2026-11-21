import { indexPaths, resolveFile, resolvePath, scan, type PathIndex } from './wikilinks.ts';

export type RewriteIndexes = {
  notes: PathIndex;
  files: PathIndex;
  nextNotes: PathIndex;
  nextFiles: PathIndex;
  nextNotePaths: string[];
  nextFilePaths: string[];
};

/** Troca o alvo dos wikilinks que apontavam para um arquivo movido. Alias e âncora ficam. */
export function rewriteLinks(
  content: string,
  source: string,
  notePaths: string[],
  filePaths: string[],
  mapPath: (filePath: string) => string,
  indexes?: RewriteIndexes,
) {
  const nextSource = mapPath(source);
  const prepared =
    indexes ||
    (() => {
      const nextNotePaths = notePaths.map(mapPath);
      const nextFilePaths = filePaths.map(mapPath);
      return {
        notes: indexPaths(notePaths),
        files: indexPaths(filePaths),
        nextNotes: indexPaths(nextNotePaths),
        nextFiles: indexPaths(nextFilePaths),
        nextNotePaths,
        nextFilePaths,
      };
    })();
  const refs = scan(content);
  if (!refs.length) return content;
  let result = content;
  for (const ref of [...refs].reverse()) {
    if (!ref.note) continue;
    const current =
      ref.format === 'embed' && hasFileExtension(ref.note)
        ? resolveFile(ref.note, source, filePaths)
        : resolvePath(ref.note, source, notePaths, prepared.notes);
    if (!current.path) continue;
    const next = mapPath(current.path);
    const still =
      ref.format === 'embed' && hasFileExtension(ref.note)
        ? resolveFile(ref.note, nextSource, prepared.nextFilePaths)
        : resolvePath(ref.note, nextSource, prepared.nextNotePaths, prepared.nextNotes);
    if (next === current.path && still.path === next) continue;
    const note =
      hasFileExtension(next) && !/\.md$/i.test(next)
        ? next
        : next.replace(/\.md$/i, /\.md$/i.test(ref.note) ? '.md' : '');
    const value =
      note + (ref.anchor ? '#' + ref.anchor : '') + (ref.alias !== null ? '|' + ref.alias : '');
    if (value === result.slice(ref.start + (ref.format === 'embed' ? 3 : 2), ref.end - 2)) continue;
    const open = ref.format === 'embed' ? '![[' : '[[';
    result = result.slice(0, ref.start) + open + value + ']]' + result.slice(ref.end);
  }
  return result;
}

export function buildRewriteIndexes(
  notePaths: string[],
  filePaths: string[],
  mapPath: (filePath: string) => string,
): RewriteIndexes {
  const nextNotePaths = notePaths.map(mapPath);
  const nextFilePaths = filePaths.map(mapPath);
  return {
    notes: indexPaths(notePaths),
    files: indexPaths(filePaths),
    nextNotes: indexPaths(nextNotePaths),
    nextFiles: indexPaths(nextFilePaths),
    nextNotePaths,
    nextFilePaths,
  };
}

function hasFileExtension(note: string) {
  return /\.[^/]+$/.test(note) && !/\.md$/i.test(note);
}
