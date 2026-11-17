import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineError } from './errors.ts';
import { MAX_SEGMENT_LENGTH, MAX_WORKSPACE_NAME } from './limits.ts';

/** `parent` contém `child`, ou os dois são o mesmo caminho. */
export function contains(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}

export type OpenOptions = {
  home?: string;
  /** Mantido para chamadas antigas. Não impede abrir a biblioteca a partir de dentro dela. */
  cwd?: string;
  protectedPaths?: string[];
};

export function defaultProtectedPaths(home = os.homedir()) {
  return ['.config', '.local', '.ssh', '.gnupg', '.codex'].map((name) => path.join(home, name));
}

/**
 * Abre a pasta da biblioteca. Recusa link simbólico e pasta protegida
 * (a própria home, ancestrais da home, .ssh, .config e equivalentes).
 * Não exige que a pasta esteja dentro da home: o chamador já escolheu o caminho.
 */
export function openLibraryRoot(folder: string, options: OpenOptions = {}) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder))
    throw new EngineError('invalid-path', 'A biblioteca precisa de um caminho absoluto.');
  const resolved = path.resolve(folder);
  let listed: fs.Stats;
  try {
    listed = fs.lstatSync(resolved);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      throw new EngineError('not-found', 'Pasta da biblioteca não encontrada.');
    throw error;
  }
  if (listed.isSymbolicLink())
    throw new EngineError('symlink', 'A biblioteca não pode ser um link simbólico.');
  if (!listed.isDirectory())
    throw new EngineError('invalid-path', 'A biblioteca precisa ser uma pasta.');
  const root = fs.realpathSync(resolved);
  if (root !== resolved)
    throw new EngineError('symlink', 'O caminho da biblioteca contém um link simbólico.');
  assertNotProtected(root, options);
  fs.accessSync(root, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  return {
    root,
    identity: { dev: String(listed.dev), ino: String(listed.ino) },
  };
}

function assertNotProtected(root: string, options: OpenOptions) {
  const home = options.home ? path.resolve(options.home) : os.homedir();
  const protectedPaths = [
    ...defaultProtectedPaths(home),
    ...(options.protectedPaths ?? []).map((entry) => path.resolve(entry)),
  ];
  // A pasta de trabalho pode estar dentro da biblioteca. A CLI depende disso.
  if (contains(root, home))
    throw new EngineError(
      'protected',
      'Essa pasta é protegida. Escolha uma pasta dedicada à biblioteca.',
    );
  for (const guarded of protectedPaths) {
    if (contains(root, guarded) || contains(guarded, root))
      throw new EngineError(
        'protected',
        'Essa pasta é protegida. Escolha uma pasta dedicada à biblioteca.',
      );
  }
}

export function validateSegment(segment: string, kind: 'workspace' | 'entry' = 'entry') {
  const limit = kind === 'workspace' ? MAX_WORKSPACE_NAME : MAX_SEGMENT_LENGTH;
  if (typeof segment !== 'string' || !segment) throw new EngineError('invalid-path', 'Informe um nome.');
  if (segment.length > limit)
    throw new EngineError('invalid-path', 'O nome passou do tamanho permitido.');
  if (segment === '.' || segment === '..' || segment.startsWith('.'))
    throw new EngineError('invalid-path', 'Nome inválido: não pode começar com ponto nem ser “..”.');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(segment))
    throw new EngineError('invalid-path', 'Esse nome é reservado pelo Windows.');
  const forbidden = segment.match(/[\x00-\x1f<>:"|?*\\/]/);
  if (forbidden)
    throw new EngineError('invalid-path', `O caractere “${forbidden[0]}” não pode entrar no nome.`);
  if (/[. ]$/.test(segment))
    throw new EngineError('invalid-path', 'O nome não pode terminar com ponto ou espaço.');
}

/** Caminho relativo POSIX, preso à biblioteca. Não segue link simbólico. */
export function resolveInside(
  root: string,
  relative: string,
  options: { allowMissing?: boolean } = {},
) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\'))
    throw new EngineError('invalid-path', 'Caminho inválido.');
  if (!relative)
    throw new EngineError('invalid-path', 'A raiz da biblioteca não pode ser alterada.');
  const parts = relative.split('/');
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    const segment = parts[index];
    validateSegment(segment, 'entry');
    const next = path.join(current, segment);
    const last = index === parts.length - 1;
    let listed: fs.Stats;
    try {
      listed = fs.lstatSync(next);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT' &&
        last &&
        options.allowMissing
      ) {
        assertInside(root, next);
        return next;
      }
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        throw new EngineError('not-found', 'Item não encontrado.');
      throw error;
    }
    if (listed.isSymbolicLink())
      throw new EngineError('symlink', 'Links simbólicos não são permitidos.');
    if (!last && !listed.isDirectory()) throw new EngineError('invalid-path', 'Pasta inválida.');
    current = next;
  }
  assertInside(root, current);
  return current;
}

function assertInside(root: string, target: string) {
  if (!contains(root, target))
    throw new EngineError('invalid-path', 'O caminho está fora da biblioteca.');
}
