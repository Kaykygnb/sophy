import { resolveFile, resolvePath, scan } from './wikilinks.ts';

/** Troca o alvo dos wikilinks que apontavam para um arquivo movido. Alias e âncora ficam. */
export function rewriteLinks(
  content: string,
  source: string,
  notePaths: string[],
  filePaths: string[],
  mapPath: (filePath: string) => string,
) {
  const nextSource = mapPath(source);
  const nextNotes = notePaths.map(mapPath);
  const nextFiles = filePaths.map(mapPath);
  const refs = scan(content);
  let result = content;
  for (const ref of [...refs].reverse()) {
    if (!ref.note) continue;
    const pool = ref.format === 'embed' ? [...notePaths, ...filePaths] : notePaths;
    const nextPool = ref.format === 'embed' ? [...nextNotes, ...nextFiles] : nextNotes;
    const current =
      ref.format === 'embed' && hasFileExtension(ref.note)
        ? resolveFile(ref.note, source, filePaths)
        : resolvePath(ref.note, source, pool);
    if (!current.path) continue;
    const next = mapPath(current.path);
    const still =
      ref.format === 'embed' && hasFileExtension(ref.note)
        ? resolveFile(ref.note, nextSource, nextFiles)
        : resolvePath(ref.note, nextSource, nextPool);
    if (next === current.path && still.path === next) continue;
    const note =
      hasFileExtension(next) && !/\.md$/i.test(next)
        ? next
        : next.replace(/\.md$/i, /\.md$/i.test(ref.note) ? '.md' : '');
    const value =
      note + (ref.anchor ? '#' + ref.anchor : '') + (ref.alias !== null ? '|' + ref.alias : '');
    const openLength = ref.format === 'embed' ? 3 : 2;
    if (value === result.slice(ref.start + openLength, ref.end - 2)) continue;
    const open = ref.format === 'embed' ? '![[' : '[[';
    result = result.slice(0, ref.start) + open + value + ']]' + result.slice(ref.end);
  }
  return result;
}

function hasFileExtension(note: string) {
  return /\.[^/]+$/.test(note) && !/\.md$/i.test(note);
}
