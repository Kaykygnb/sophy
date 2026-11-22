import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EngineError } from './errors.ts';
import { capture, diff, listHistory, pushHistory, undoById } from './history.ts';
import type { Library } from './library.ts';
import { resolveInside } from './paths.ts';
import type { Author } from './call-context.ts';

export type Atividade = {
  id: string;
  autor: string;
  tool: string;
  label: string;
  notePath: string | null;
  versionId: string | null;
  quando: string;
};

type Stored = Atividade & {
  antes: string | null;
  depois: string | null;
};

type BlobLike =
  | { encoding: 'utf8'; text: string }
  | { encoding: 'base64'; data: string }
  | null;

const FILE = 'atividade.jsonl';
const ROTATED = 'atividade.1.jsonl';

export function snapshotFromChanges(
  changes: ReadonlyArray<{ type: string; path: string; before?: BlobLike; after?: BlobLike }>,
) {
  const files = changes.filter((change) => change.type === 'file');
  const chosen = files.find((change) => change.path.toLowerCase().endsWith('.md')) ?? files[0];
  if (!chosen) return { notePath: null, antes: null, depois: null };
  return {
    notePath: chosen.path,
    antes: textOf(chosen.before ?? null),
    depois: textOf(chosen.after ?? null),
  };
}

export function recordActivity(
  library: Library,
  input: {
    autor: Author | string;
    tool: string;
    label: string;
    notePath: string | null;
    versionId: string | null;
    antes: string | null;
    depois: string | null;
    quando?: string;
  },
): Atividade {
  const row: Stored = {
    id: randomUUID(),
    autor: input.autor,
    tool: input.tool,
    label: input.label,
    notePath: input.notePath,
    versionId: input.versionId,
    quando: input.quando ?? new Date().toISOString(),
    antes: input.antes,
    depois: input.depois,
  };
  const dir = path.join(library.root, '.sophy');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, FILE);
  const line = `${JSON.stringify(row)}\n`;
  const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  if (size > 0 && size + Buffer.byteLength(line) > maxBytes()) {
    const rotated = path.join(dir, ROTATED);
    fs.rmSync(rotated, { force: true });
    fs.renameSync(file, rotated);
  }
  fs.appendFileSync(file, line);
  return publish(row);
}

export function listActivity(
  library: Library,
  query: { autor?: string; de?: string; ate?: string; limite?: number } = {},
): Atividade[] {
  let rows = readRows(library);
  if (query.autor) rows = rows.filter((row) => row.autor === query.autor);
  if (query.de) {
    const from = parseWhen(query.de, 'de');
    rows = rows.filter((row) => Date.parse(row.quando) >= from);
  }
  if (query.ate) {
    const to = parseWhen(query.ate, 'ate');
    rows = rows.filter((row) => Date.parse(row.quando) <= to);
  }
  rows.sort((a, b) => (a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0));
  const limite = query.limite ?? 50;
  return rows.slice(0, limite).map(publish);
}

export function diffActivity(library: Library, id: string) {
  const row = readRows(library).find((item) => item.id === id);
  if (!row) throw new EngineError('atividade_inexistente', 'Não encontrei essa atividade.');
  return { antes: row.antes, depois: row.depois };
}

export function undoActivity(library: Library, id: string, forcar = false) {
  const row = readRows(library).find((item) => item.id === id);
  if (!row) throw new EngineError('atividade_inexistente', 'Não encontrei essa atividade.');
  if (row.notePath && !forcar && readMaybe(library, row.notePath) !== row.depois) {
    return { erro: 'conflito' as const, versionIdAtual: latestVersion(library, row.notePath) };
  }
  const before = capture(library);
  try {
    if (row.versionId) undoById(library, row.versionId, { force: forcar === true });
    else restoreSnapshot(library, row);
  } catch (error) {
    if (error instanceof EngineError && error.code === 'conflict')
      return {
        erro: 'conflito' as const,
        versionIdAtual: row.notePath ? latestVersion(library, row.notePath) : null,
      };
    if (error instanceof EngineError && (error.code === 'not-found' || error.code === 'already-undone'))
      restoreSnapshot(library, row);
    else throw error;
  }
  const changes = diff(before, capture(library));
  const hist = pushHistory(library, {
    origin: 'ui',
    tool: 'activity.undo',
    summary: `Desfazer ${row.label}`,
    changes,
  });
  const recorded = recordActivity(library, {
    autor: 'usuario',
    tool: 'activity.undo',
    label: `Desfazer ${row.label}`,
    notePath: row.notePath,
    versionId: hist?.id ?? null,
    antes: row.depois,
    depois: row.antes,
  });
  return { id: recorded.id, desfeito: row.id, autor: 'usuario' as const, versionId: recorded.versionId };
}

function latestVersion(library: Library, notePath: string) {
  const hit = listHistory(library).find((item) => item.paths.includes(notePath));
  return hit?.id ?? null;
}

function restoreSnapshot(library: Library, row: Stored) {
  if (!row.notePath) return;
  if (row.antes === null) {
    const full = resolveInside(library.root, row.notePath);
    if (fs.existsSync(full)) fs.rmSync(full, { force: true });
    return;
  }
  const full = resolveInside(library.root, row.notePath, { allowMissing: true });
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, row.antes);
}

function readMaybe(library: Library, relative: string) {
  try {
    return fs.readFileSync(resolveInside(library.root, relative), 'utf8');
  } catch {
    return null;
  }
}

function textOf(blob: BlobLike) {
  if (!blob) return null;
  if (blob.encoding === 'utf8') return blob.text;
  return Buffer.from(blob.data, 'base64').toString('utf8');
}

function readRows(library: Library): Stored[] {
  const dir = path.join(library.root, '.sophy');
  const rows: Stored[] = [];
  for (const name of [ROTATED, FILE]) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Stored;
        if (parsed && typeof parsed.id === 'string') rows.push(parsed);
      } catch {
        /* linha incompleta na rotação */
      }
    }
  }
  return rows;
}

function publish(row: Stored): Atividade {
  return {
    id: row.id,
    autor: row.autor,
    tool: row.tool,
    label: row.label,
    notePath: row.notePath,
    versionId: row.versionId,
    quando: row.quando,
  };
}

function parseWhen(value: string, field: string) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new EngineError('data_invalida', `A data de ${field} é inválida.`);
  return time;
}

function maxBytes() {
  const raw = process.env.SOPHY_ACTIVITY_MAX_BYTES;
  if (!raw) return 1024 * 1024;
  const size = Number(raw);
  return Number.isFinite(size) && size >= 64 ? Math.floor(size) : 1024 * 1024;
}
