import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openLibrary } from './library.ts';
import { EngineError } from './errors.ts';

export function settingsPath() {
  if (process.env.SOPHY_SETTINGS_DIR) return path.join(process.env.SOPHY_SETTINGS_DIR, 'ui.json');
  const base =
    process.platform === 'win32'
      ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'Sophy', 'ui.json');
}

export function readCatalog(file = settingsPath()): string[] {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new EngineError(
      'not-found',
      'Não foi possível ler as bibliotecas cadastradas. Abra uma biblioteca no Sophy ou informe --biblioteca.',
    );
  }
  const folders = [
    settings.libraryPath,
    ...(Array.isArray(settings.libraries) ? settings.libraries : []),
  ];
  return [
    ...new Set(
      folders.filter((item): item is string => typeof item === 'string' && path.isAbsolute(item)),
    ),
  ];
}

export function libraryCatalog(folders: string[]) {
  return [...new Set(folders.map((folder) => path.resolve(folder)))].map((folder) => {
    let root = folder;
    let available = true;
    try {
      root = openLibrary(folder).root;
    } catch {
      available = false;
    }
    const key = process.platform === 'win32' ? root.toLowerCase() : root;
    return {
      id: createHash('sha256').update(key).digest('hex').slice(0, 24),
      name: path.basename(root),
      root,
      available,
    };
  });
}
