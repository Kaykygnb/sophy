import fs from 'node:fs';
import path from 'node:path';
import { EngineError } from './errors.ts';
import type { Library } from './library.ts';

export type ShelfStyle = { color: number; icon: string };

const ICONS = new Set([
  'capelo',
  'livro',
  'lampada',
  'maleta',
  'nota-diaria',
  'leitura',
  'coracao',
  'estante',
  'pasta',
  'grafo',
  'faisca',
  'tag',
  'calendario',
  'conversa',
  'favorito',
  'caixa-entrada',
]);

function fileOf(library: Library) {
  return path.join(library.root, '.sophy', 'estantes.json');
}

export function readShelfStyles(library: Library): Record<string, ShelfStyle> {
  const file = fileOf(library);
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, ShelfStyle>;
}

export function writeShelfStyle(library: Library, name: string, style: ShelfStyle) {
  if (!name || name.startsWith('.') || name.includes('/') || name.includes('\\'))
    throw new EngineError('invalid-path', 'Nome de estante inválido.');
  if (!Number.isInteger(style.color) || style.color < 1 || style.color > 8)
    throw new EngineError('invalid-note', 'A cor da estante vai de 1 a 8.');
  if (!ICONS.has(style.icon)) throw new EngineError('invalid-note', 'Ícone de estante desconhecido.');
  const dir = path.join(library.root, '.sophy');
  fs.mkdirSync(dir, { recursive: true });
  const all = readShelfStyles(library);
  all[name] = { color: style.color, icon: style.icon };
  fs.writeFileSync(fileOf(library), JSON.stringify(all, null, 2));
  return all;
}
