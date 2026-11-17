import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineError } from './errors.ts';

export type TrashOptions = {
  /** Pasta da lixeira (pai de `files/` e `info/`). Testes usam um diretório temporário. */
  trashRoot?: string;
};

/** Move o item para a lixeira. Se a lixeira falhar, o original permanece. */
export function moveToTrash(source: string, options: TrashOptions = {}) {
  const listed = fs.lstatSync(source);
  if (listed.isSymbolicLink())
    throw new EngineError('symlink', 'Links simbólicos não são permitidos.');
  const root = trashRoot(options);
  const files = path.join(root, 'files');
  const info = path.join(root, 'info');
  fs.mkdirSync(files, { recursive: true });
  fs.mkdirSync(info, { recursive: true });
  const base = uniqueName(files, path.basename(source));
  const destination = path.join(files, base);
  const infoFile = path.join(info, base + '.trashinfo');
  const stamp = localStamp();
  const payload =
    '[Trash Info]\n' + `Path=${encodeTrashPath(source)}\n` + `DeletionDate=${stamp}\n`;
  fs.writeFileSync(infoFile, payload, { flag: 'wx' });
  try {
    placeInTrash(source, destination);
  } catch (error) {
    try {
      fs.rmSync(destination, { recursive: true, force: true });
    } catch {
      /* a cópia parcial não pode ficar na lixeira */
    }
    try {
      fs.unlinkSync(infoFile);
    } catch {
      /* o original continua no lugar */
    }
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    throw new EngineError(
      'trash-failed',
      code === 'EXDEV'
        ? 'Não foi possível mover para a lixeira. Nada foi apagado.'
        : 'Não foi possível mover para a lixeira. Nada foi apagado.',
    );
  }
  return { trashPath: destination, infoPath: infoFile };
}

function placeInTrash(source: string, destination: string) {
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code !== 'EXDEV') throw error;
    fs.cpSync(source, destination, { recursive: true, errorOnExist: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
}

function trashRoot(options: TrashOptions) {
  if (options.trashRoot) return options.trashRoot;
  const data = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(data, 'Trash');
}

function uniqueName(directory: string, name: string) {
  if (!fs.existsSync(path.join(directory, name))) return name;
  const extension = path.extname(name);
  const stem = name.slice(0, name.length - extension.length) || 'item';
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${stem} ${index}${extension}`;
    if (!fs.existsSync(path.join(directory, candidate))) return candidate;
  }
  throw new EngineError('trash-failed', 'Não foi possível mover para a lixeira. Nada foi apagado.');
}

function localStamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function encodeTrashPath(value: string) {
  return [...Buffer.from(value)]
    .map((byte) => {
      const unreserved =
        (byte >= 0x41 && byte <= 0x5a) ||
        (byte >= 0x61 && byte <= 0x7a) ||
        (byte >= 0x30 && byte <= 0x39) ||
        byte === 0x2f ||
        byte === 0x2d ||
        byte === 0x5f ||
        byte === 0x2e ||
        byte === 0x7e;
      return unreserved
        ? String.fromCharCode(byte)
        : '%' + byte.toString(16).toUpperCase().padStart(2, '0');
    })
    .join('');
}
