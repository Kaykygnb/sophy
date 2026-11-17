import fs from 'node:fs';
import path from 'node:path';
import { EngineError } from './errors.ts';
import { listNotes, readNote, type Library } from './library.ts';
import { resolveInside } from './paths.ts';

const DAY = 24 * 60 * 60 * 1000;

export type StudyCard = {
  id: string;
  path: string;
  line: number;
  front: string;
  back: string;
  workspace: string | null;
  due: string;
  box: number;
  reversible?: boolean;
};

type Schedule = Record<string, { due: string; box: number }>;

function deckFile(library: Library) {
  return path.join(library.root, '.sophy', 'flashcards.json');
}

function readSchedule(library: Library): Schedule {
  const file = deckFile(library);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { cards?: Schedule };
    return parsed.cards || {};
  } catch {
    return {};
  }
}

function writeSchedule(library: Library, cards: Schedule) {
  const dir = path.join(library.root, '.sophy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(deckFile(library), `${JSON.stringify({ cards }, null, 2)}\n`);
}

export function cardsInText(body: string, notePath: string, workspace: string | null, today: string) {
  const lines = String(body || '').split(/\r?\n/);
  const cards: StudyCard[] = [];
  let fence = false;
  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const triple = line.match(/^(.+?)\s:::\s(.+)$/);
    const pair = triple ? null : line.match(/^(.+?)\s::\s(.+)$/);
    const match = triple || pair;
    if (!match) return;
    cards.push({
      id: `${notePath}:${index + 1}`,
      path: notePath,
      line: index + 1,
      front: match[1].trim(),
      back: match[2].trim(),
      workspace,
      due: today,
      box: 0,
      reversible: Boolean(triple),
    });
  });
  return cards;
}

export function listCards(library: Library, today: string, workspace?: string) {
  const schedule = readSchedule(library);
  const cards: StudyCard[] = [];
  for (const note of listNotes(library)) {
    if (workspace && note.workspace !== workspace) continue;
    const doc = readNote(library, note.path);
    for (const card of cardsInText(doc.body, note.path, note.workspace, today)) {
      const saved = schedule[card.id];
      cards.push(saved ? { ...card, due: saved.due, box: saved.box } : card);
    }
  }
  return cards;
}

export function reviewCard(library: Library, id: string, knew: boolean, today: string) {
  const [notePath] = id.split(':');
  const note = listNotes(library).find((item) => item.path === notePath);
  if (!note) throw new EngineError('not-found', 'Cartão não encontrado.');
  const doc = readNote(library, note.path);
  const card = cardsInText(doc.body, note.path, note.workspace, today).find((item) => item.id === id);
  if (!card) throw new EngineError('not-found', 'Cartão não encontrado.');
  const schedule = readSchedule(library);
  const box = knew ? Math.min(5, (schedule[id]?.box || 0) + 1) : 0;
  const due = addDays(today, knew ? [1, 2, 4, 8, 16, 32][box] : 1);
  schedule[id] = { due, box };
  writeSchedule(library, schedule);
  return { ...card, due, box };
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function saveVersionPoint(
  library: Library,
  label: string,
  options: { now?: Date; maxBytes?: number; maxAgeMs?: number } = {},
) {
  const now = options.now || new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const root = path.join(library.root, '.sophy', 'versoes', stamp);
  fs.mkdirSync(root, { recursive: true });
  const files = collectNotes(library.root);
  for (const file of files) {
    const target = path.join(root, file.relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file.full, target);
  }
  fs.writeFileSync(path.join(root, 'ponto.json'), `${JSON.stringify({ label, at: now.toISOString() })}\n`);
  const removed = pruneVersions(path.join(library.root, '.sophy', 'versoes'), {
    now,
    maxBytes: options.maxBytes ?? 1024 * 1024 * 1024,
    maxAgeMs: options.maxAgeMs ?? 90 * DAY,
  });
  return { stamp, files: files.length, removed };
}

function collectNotes(root: string) {
  const files: { relative: string; full: string }[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(md|canvas)$/i.test(entry.name))
        files.push({ relative: path.relative(root, full).split(path.sep).join('/'), full });
    }
  };
  walk(root);
  return files;
}

export function pruneVersions(
  directory: string,
  options: { now: Date; maxBytes: number; maxAgeMs: number },
) {
  if (!fs.existsSync(directory)) return [];
  const points = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const full = path.join(directory, entry.name);
      return {
        name: entry.name,
        full,
        bytes: dirSize(full),
        time: pointTime(full, fs.statSync(full).mtimeMs),
      };
    })
    .sort((a, b) => a.time - b.time);
  const removed: string[] = [];
  const drop = (point: (typeof points)[number]) => {
    fs.rmSync(point.full, { recursive: true, force: true });
    removed.push(point.name);
    point.bytes = 0;
  };
  for (const point of points) {
    if (options.now.getTime() - point.time > options.maxAgeMs) drop(point);
  }
  let total = points.reduce((sum, point) => sum + point.bytes, 0);
  for (const point of points) {
    if (total <= options.maxBytes) break;
    if (!point.bytes) continue;
    total -= point.bytes;
    drop(point);
  }
  return removed;
}

export function restoreVersion(library: Library, id: string) {
  if (!/^[\w.:-]+$/.test(id)) throw new EngineError('invalid-path', 'Ponto inválido.');
  const source = path.join(library.root, '.sophy', 'versoes', id);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new EngineError('not-found', 'Ponto não encontrado.');
  const files = collectNotes(source);
  for (const file of files) {
    const parts = file.relative.split('/');
    let parent = '';
    for (const part of parts.slice(0, -1)) {
      parent = parent ? `${parent}/${part}` : part;
      const folder = resolveInside(library.root, parent, { allowMissing: true });
      if (!fs.existsSync(folder)) fs.mkdirSync(folder);
    }
    const destination = resolveInside(library.root, file.relative, { allowMissing: true });
    fs.copyFileSync(file.full, destination);
  }
  return { restored: files.length, id };
}

function pointTime(full: string, fallback: number) {
  try {
    const at = (JSON.parse(fs.readFileSync(path.join(full, 'ponto.json'), 'utf8')) as { at?: string }).at;
    const time = at ? Date.parse(at) : Number.NaN;
    if (!Number.isNaN(time)) return time;
  } catch {
    /* usa a data do disco */
  }
  return fallback;
}

function dirSize(directory: string) {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

export function listVersions(library: Library) {
  const directory = path.join(library.root, '.sophy', 'versoes');
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const full = path.join(directory, entry.name);
      let label = entry.name;
      try {
        label = (JSON.parse(fs.readFileSync(path.join(full, 'ponto.json'), 'utf8')) as { label?: string }).label || label;
      } catch {
        /* ponto sem rótulo */
      }
      return { id: entry.name, label, bytes: dirSize(full) };
    });
}

export function weeklyReview(now: Date, weekStartsOn = 1) {
  if (weekStartsOn !== 0 && weekStartsOn !== 1)
    throw new EngineError('invalid-note', 'A semana começa no domingo ou na segunda.');
  const day = now.getDay();
  const shift = weekStartsOn === 1 ? (day + 6) % 7 : day;
  const start = new Date(now);
  start.setDate(now.getDate() - shift);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { notice: day === 0, weekStartsOn, from: iso(start), to: iso(end) };
}

function tokensOf(text: string) {
  return text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 2);
}

export function enableSemantic(library: Library) {
  const index: Record<string, string[]> = {};
  for (const note of listNotes(library)) {
    const doc = readNote(library, note.path);
    index[note.path] = [...new Set(tokensOf(`${doc.body}`))];
  }
  const dir = path.join(library.root, '.sophy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'busca.json'), `${JSON.stringify({ index })}\n`);
  return { notes: Object.keys(index).length };
}

export function semanticSearch(library: Library, query: string) {
  const file = path.join(library.root, '.sophy', 'busca.json');
  if (!fs.existsSync(file)) return { enabled: false as const, hits: [] };
  const index = (JSON.parse(fs.readFileSync(file, 'utf8')) as { index: Record<string, string[]> }).index || {};
  const wanted = new Set(tokensOf(query));
  const hits = Object.entries(index)
    .map(([notePath, tokens]) => ({
      path: notePath,
      score: tokens.filter((token) => wanted.has(token)).length,
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);
  return { enabled: true as const, hits };
}

export function exportSite(library: Library, destination: string, theme: 'light' | 'dark') {
  const target = path.resolve(destination);
  const stat = fs.existsSync(target) ? fs.lstatSync(target) : null;
  if (stat?.isSymbolicLink()) throw new EngineError('symlink', 'O destino não pode ser um link.');
  const libraryReal = fs.realpathSync(library.root);
  if (fs.existsSync(target)) {
    const destReal = fs.realpathSync(target);
    if (destReal === libraryReal || destReal.startsWith(libraryReal + path.sep))
      throw new EngineError('invalid-path', 'O site não é gravado dentro da biblioteca.');
  }
  fs.mkdirSync(target, { recursive: true });
  const notes = listNotes(library);
  const pages = notes.map((note) => {
    const doc = readNote(library, note.path);
    const name = `${note.path.replace(/\.md$/i, '').replaceAll('/', '-')}.html`;
    const html = pageHtml(note.path, doc.body, theme);
    fs.writeFileSync(path.join(target, name), html);
    return { href: name, title: note.name.replace(/\.md$/i, '') };
  });
  const index = `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><title>Biblioteca</title>${siteStyle()}</head><body><h1>Biblioteca</h1><ul>${pages
    .map((page) => `<li><a href="${escape(page.href)}">${escape(page.title)}</a></li>`)
    .join('')}</ul></body></html>\n`;
  fs.writeFileSync(path.join(target, 'index.html'), index);
  return { pages: pages.length, theme };
}

export function lightPaperHtml(title: string, body: string) {
  return pageHtml(title, body, 'light');
}

function pageHtml(title: string, body: string, theme: 'light' | 'dark') {
  const blocks = body
    .split(/\r?\n\r?\n/)
    .map((block) => `<p>${escape(block)}</p>`)
    .join('');
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><title>${escape(title)}</title>${siteStyle()}</head><body><article><h1>${escape(title)}</h1>${blocks}</article></body></html>\n`;
}

function siteStyle() {
  return `<style>
    html[data-theme="light"] { background: #fff; color: #1c1b22; }
    html[data-theme="dark"] { background: #14131a; color: #f4f1ea; }
    body { font: 18px/1.5 Georgia, serif; margin: 0; }
    article, body { max-width: 680px; margin: 40px auto; padding: 0 24px; }
  </style>`;
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
