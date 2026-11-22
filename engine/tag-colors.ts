import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EngineError } from './errors.ts';
import type { Library } from './library.ts';
import { cleanTag, tagKey } from './tags.ts';

/**
 * Nomes de `data-cor` e `data-fundo` no editor (`src/ui/rich-text.js`).
 * O motor não importa a interface: a lista é a mesma, copiada aqui.
 */
export const EDITOR_TAG_COLORS = [
  'cinza',
  'marrom',
  'laranja',
  'amarelo',
  'verde',
  'azul',
  'roxo',
  'rosa',
  'vermelho',
] as const;

const PALETTE = new Set<string>(EDITOR_TAG_COLORS);

/**
 * A cor fica em `.sophy/tags.json`. `capture()` só vê notas e arquivos
 * visíveis, e `history.undo` não regrava caminho que começa com ponto, então
 * este arquivo não entra no histórico. Quem grava passa por `tracked()` para
 * levar o autor da chamada, como `shelf.style.set`. A escrita em si é
 * atômica: arquivo temporário, `fsync` e `rename`.
 */
export function readTagColors(library: Library): Record<string, string> {
  const colors = new Map<string, string>();
  const file = colorFile(library);
  if (!fs.existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const cores = (parsed as { cores?: unknown }).cores;
  if (!cores || typeof cores !== 'object' || Array.isArray(cores)) return {};
  for (const [rawKey, rawColor] of Object.entries(cores)) {
    const name = cleanTag(rawKey);
    if (!name || typeof rawColor !== 'string') continue;
    const color = normalizeTagColor(rawColor);
    if (!color) continue;
    colors.set(tagKey(name), color);
  }
  return Object.fromEntries([...colors.entries()].sort(byKey));
}

export function setTagColor(library: Library, tag: string, cor: string | null) {
  const name = cleanTag(tag);
  if (!name) throw new EngineError('tag_invalida', 'A tag é inválida.');
  const key = tagKey(name);
  const colors = readTagColors(library);
  if (cor === null || cor === '') {
    delete colors[key];
    persist(library, colors);
    return { tag: key, cor: null };
  }
  const parsed = normalizeTagColor(cor);
  if (!parsed) throw new EngineError('cor_invalida', 'A cor é inválida.');
  colors[key] = parsed;
  persist(library, colors);
  return { tag: key, cor: parsed };
}

/** Leva a cor da tag e das descendentes para o nome novo. A cor do destino fica, se os dois tinham. */
export function migrateTagColors(library: Library, from: string, to: string) {
  const fromName = cleanTag(from);
  const toName = cleanTag(to);
  if (!fromName || !toName) return;
  const fromKey = tagKey(fromName);
  const toKey = tagKey(toName);
  if (fromKey === toKey) return;
  const current = readTagColors(library);
  const staying: Record<string, string> = {};
  const moving: Array<{ dest: string; color: string }> = [];
  for (const [key, color] of Object.entries(current)) {
    if (key === fromKey || key.startsWith(fromKey + '/')) {
      const dest = toKey + key.slice(fromKey.length);
      if (dest === key) staying[key] = color;
      else moving.push({ dest, color });
    } else staying[key] = color;
  }
  if (!moving.length) return;
  const next = { ...staying };
  for (const move of moving) {
    if (!Object.prototype.hasOwnProperty.call(next, move.dest)) next[move.dest] = move.color;
  }
  persist(library, next);
}

function normalizeTagColor(input: string) {
  const trimmed = input.normalize('NFC').trim();
  if (!trimmed) return null;
  const named = trimmed.toLocaleLowerCase('pt-BR');
  if (PALETTE.has(named)) return named;
  const hex = trimmed.toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  return null;
}

function persist(library: Library, colors: Record<string, string>) {
  const file = colorFile(library);
  const body = canonical(colors);
  if (fs.existsSync(file)) {
    try {
      if (fs.readFileSync(file, 'utf8') === body) return;
    } catch {
      /* arquivo ilegível: a gravação troca pelo JSON canônico */
    }
  } else if (!Object.keys(colors).length) return;
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temp = path.join(directory, `.tags-${randomUUID()}`);
  try {
    fs.writeFileSync(temp, body, { flag: 'wx' });
    const fd = fs.openSync(temp, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function canonical(colors: Record<string, string>) {
  const cores = Object.fromEntries(Object.entries(colors).sort(byKey));
  return `${JSON.stringify({ cores }, null, 2)}\n`;
}

function byKey(a: [string, string], b: [string, string]) {
  return a[0].localeCompare(b[0], 'pt-BR') || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

function colorFile(library: Library) {
  return path.join(library.root, '.sophy', 'tags.json');
}
