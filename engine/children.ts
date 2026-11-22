import fs from 'node:fs';
import path from 'node:path';
import { EngineError } from './errors.ts';
import {
  createNote,
  moveEntry,
  openLibrary,
  readNote,
  writeNote,
  type Library,
} from './library.ts';
import { resolveInside } from './paths.ts';

type MothersFile = { mothers: string[] };

function mothersPath(library: Library) {
  return path.join(library.root, '.sophy', 'mothers.json');
}

export function readMothers(library: Library): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(mothersPath(library), 'utf8')) as MothersFile;
    return Array.isArray(raw.mothers) ? raw.mothers.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

export function writeMothers(library: Library, mothers: string[]) {
  fs.mkdirSync(path.join(library.root, '.sophy'), { recursive: true });
  fs.writeFileSync(mothersPath(library), JSON.stringify({ mothers: [...new Set(mothers)] }, null, 2));
}

export function isMother(library: Library, relative: string) {
  return readMothers(library).includes(relative.replace(/\\/g, '/'));
}

export function registerMother(library: Library, relative: string) {
  const pathName = relative.replace(/\\/g, '/');
  const mothers = readMothers(library);
  if (!mothers.includes(pathName)) writeMothers(library, [...mothers, pathName]);
}

export function unregisterMother(library: Library, relative: string) {
  const pathName = relative.replace(/\\/g, '/');
  writeMothers(
    library,
    readMothers(library).filter((item) => item !== pathName),
  );
}

export function motherFolder(relative: string) {
  return relative.replace(/\.md$/i, '');
}

export function listChildren(library: Library, relative: string) {
  if (!isMother(library, relative)) return [];
  const folder = motherFolder(relative);
  const full = resolveInside(library.root, folder, { allowMissing: true });
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return [];
  return fs
    .readdirSync(full)
    .filter((name) => name.toLowerCase().endsWith('.md'))
    .map((name) => `${folder}/${name}`.replace(/\\/g, '/'))
    .sort((a, b) => a.localeCompare(b, 'pt'));
}

export function createChildNote(library: Library, parent: string, title: string) {
  const parentPath = parent.replace(/\\/g, '/');
  if (!parentPath.toLowerCase().endsWith('.md'))
    throw new EngineError('invalid-note', 'A mãe precisa ser uma nota.');
  registerMother(library, parentPath);
  const folder = motherFolder(parentPath);
  const safe = title.replace(/[\\/:*?"<>|]/g, '').trim() || 'Sem título';
  const childPath = `${folder}/${safe}.md`;
  const note = createNote(library, childPath, `# ${safe}\n\n`);
  return note;
}

/** Move mãe + pasta filha; se falhar no meio, desfaz. */
export function moveMotherTree(library: Library, source: string, target: string) {
  const from = source.replace(/\\/g, '/');
  const to = target.replace(/\\/g, '/');
  if (!isMother(library, from)) return moveEntry(library, from, to);
  const fromFolder = motherFolder(from);
  const toFolder = motherFolder(to);
  const fromFolderFull = resolveInside(library.root, fromFolder, { allowMissing: true });
  const hadFolder = fs.existsSync(fromFolderFull) && fs.statSync(fromFolderFull).isDirectory();
  const movedNote = moveEntry(library, from, to);
  try {
    if (hadFolder) {
      const destFolder = resolveInside(library.root, toFolder, { allowMissing: true });
      if (fs.existsSync(destFolder))
        throw new EngineError('exists', 'Já existe pasta de filhas no destino.');
      fs.renameSync(fromFolderFull, destFolder);
    }
    const mothers = readMothers(library).map((item) => (item === from ? to : item));
    writeMothers(library, mothers);
    return movedNote;
  } catch (error) {
    try {
      moveEntry(library, to, from);
    } catch {
      /* melhor esforço */
    }
    throw error;
  }
}

export function orphanPairs(library: Library) {
  const root = library.root;
  const pairs: Array<{ note: string; folder: string }> = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    visit(path.join(root, entry.name), entry.name);
  }
  function visit(directory: string, prefix: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        const note = `${relative}.md`;
        const noteFull = resolveInside(library.root, note, { allowMissing: true });
        if (fs.existsSync(noteFull) && !isMother(library, note)) {
          pairs.push({ note, folder: relative });
        }
        visit(path.join(directory, entry.name), relative);
      }
    }
  }
  return pairs;
}

export { openLibrary, readNote, writeNote };
