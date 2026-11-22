import fs from 'node:fs';
import path from 'node:path';
import { libraryCatalog, readCatalog, settingsPath } from './catalog.ts';
import { EngineError } from './errors.ts';
import { listDirectories, listNotes, openLibrary, readNote } from './library.ts';

export type BibliotecaSofi = {
  id: string;
  name: string;
  path: string;
  current: boolean;
};

function samePath(left: string, right: string) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function readSettings(file: string) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new EngineError('invalid-path', 'O arquivo de bibliotecas está inválido.');
    }
    return {};
  }
}

/** Mesma gravação de `rememberLibrary` no processo principal: não duplica a lista. */
export function rememberLibrary(folder: string, file = settingsPath()) {
  const opened = openLibrary(folder);
  const settings = readSettings(file);
  const previous = Array.isArray(settings.libraries) ? settings.libraries : [];
  const libraries = [
    opened.root,
    ...previous.filter((item) => typeof item === 'string' && !samePath(item, opened.root)),
  ];
  const next = {
    ...settings,
    libraryPath: opened.root,
    onboarded: true,
    libraries,
    recentLibraries: libraries.slice(0, 5),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return { root: opened.root, name: path.basename(opened.root), libraries };
}

export function listLibrariesForAgent(current?: string, file = settingsPath()): BibliotecaSofi[] {
  let folders: string[] = [];
  try {
    folders = readCatalog(file);
  } catch {
    folders = [];
  }
  if (current && !folders.some((item) => samePath(item, current))) folders.push(current);
  const seen = new Set<string>();
  const listed: BibliotecaSofi[] = [];
  for (const entry of libraryCatalog(folders)) {
    const key = process.platform === 'win32' ? entry.root.toLowerCase() : entry.root;
    if (seen.has(key)) continue;
    seen.add(key);
    listed.push({
      id: entry.id,
      name: entry.name,
      path: entry.root,
      current: Boolean(current && samePath(entry.root, current)),
    });
  }
  return listed;
}

function resolveLibrary(id: string, current: string | undefined, file: string) {
  if (
    typeof id !== 'string' ||
    !id.trim() ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('..')
  ) {
    throw new EngineError('not-found', 'Biblioteca não encontrada.');
  }
  const found = listLibrariesForAgent(current, file).find((item) => item.id === id);
  if (!found) throw new EngineError('not-found', 'Biblioteca não encontrada.');
  try {
    return { found, opened: openLibrary(found.path) };
  } catch {
    throw new EngineError('not-found', 'A biblioteca não está disponível.');
  }
}

export function readLibraryForAgent(
  id: string,
  notePath: string | undefined,
  current?: string,
  file = settingsPath(),
) {
  const { found, opened } = resolveLibrary(id, current, file);
  if (!notePath) {
    return {
      id: found.id,
      name: found.name,
      path: opened.root,
      notas: listNotes(opened).map((note) => ({
        path: note.path,
        name: note.name,
        workspace: note.workspace,
      })),
      pastas: listDirectories(opened),
    };
  }
  const nota = readNote(opened, notePath, { ensureId: false });
  return {
    id: found.id,
    name: found.name,
    biblioteca: opened.root,
    path: nota.path,
    body: nota.body,
    frontmatter: nota.frontmatter,
    revision: nota.revision,
  };
}

export function switchLibraryForAgent(id: string, current?: string, file = settingsPath()) {
  const { found } = resolveLibrary(id, current, file);
  const opened = rememberLibrary(found.path, file);
  return { id: found.id, name: opened.name, path: opened.root };
}
