import { EngineError } from './errors.ts';
import { catalogNotes } from './links.ts';
import { listFiles, openLibrary } from './library.ts';
import { anchorExists, resolveFile, resolvePath, scan } from './wikilinks.ts';

/** Wikilinks da resposta que não apontam para nota, seção ou bloco do índice. Não altera o texto. */
export function wikilinksInexistentes(libraryPath: string, text: string, source = '') {
  let library;
  try {
    library = openLibrary(libraryPath);
  } catch (error) {
    if (error instanceof EngineError) return [];
    throw error;
  }
  const catalog = catalogNotes(library);
  const paths = catalog.map((note) => note.path);
  const byPath = new Map(catalog.map((note) => [note.path, note]));
  const files = listFiles(library).map((file) => file.path);
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const link of scan(text)) {
    const fileLike =
      link.format === 'embed' && /\.[^/]+$/.test(link.note) && !/\.md$/i.test(link.note);
    const resolved = fileLike
      ? resolveFile(link.note, source, files)
      : resolvePath(link.note, source, paths);
    let exists = !resolved.invalid && resolved.candidates.length > 0;
    if (exists && link.anchor && !fileLike) {
      const notes = resolved.candidates
        .map((candidate) => byPath.get(candidate))
        .filter((note) => note !== undefined);
      exists = notes.some((note) => anchorExists(note.headings, note.blockIds, link.anchor));
    }
    if (exists || seen.has(link.raw)) continue;
    seen.add(link.raw);
    missing.push(link.raw);
  }
  return missing;
}
