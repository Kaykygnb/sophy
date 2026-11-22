import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EngineError } from './errors.ts';
import { listNotes, readNote, type Library } from './library.ts';
import { noteIdOf } from './note-id.ts';
import { resolveInside } from './paths.ts';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Agendamento dos cartões (um passo SM-2 curto).
 *
 * Estado guardado: `{ due, interval, ease, lapses }`.
 * ease começa em 2.5 e não desce de 1.3. O intervalo fica com duas casas.
 * A data soma `max(1, round(intervalo))` dias.
 *
 * | nota | nome    | efeito                                                                 |
 * | ---- | ------- | ---------------------------------------------------------------------- |
 * | 1    | errei   | intervalo = 1 dia, lapses + 1, ease − 0.2                              |
 * | 2    | difícil | intervalo × 1.2 (parte de 1 dia se ainda não havia), ease − 0.15       |
 * | 3    | bom     | primeira vez (intervalo < 1) = 1 dia; se o intervalo é 1 = 3 dias; senão intervalo × ease |
 * | 4    | fácil   | intervalo × ease × 1.3 (parte de 1 dia se ainda não havia), ease + 0.15 |
 *
 * `knew: true` vale nota 3 e `knew: false` vale nota 1.
 * Um agendamento antigo `{ due, box }` vira o formato novo na leitura e
 * conserva o `due`. A caixa Leitner 0..5 mapeia para 1, 2, 4, 8, 16, 32 dias.
 *
 * Rótulos dos botões (`intervals`): menos de 7 dias `Nd`; até 30 `Nsem`;
 * até um ano `Nmês`; depois `Na`.
 */
export type StudyCard = {
  id: string;
  path: string;
  line: number;
  front: string;
  back: string;
  workspace: string | null;
  due: string;
  interval: number;
  ease: number;
  lapses: number;
  intervals: Record<1 | 2 | 3 | 4, string>;
  reversible?: boolean;
};

type ScheduleState = {
  due: string;
  interval: number;
  ease: number;
  lapses: number;
};

type ScheduleEntry = ScheduleState & {
  previous?: ScheduleState | null;
};

type Schedule = Record<string, ScheduleEntry>;

const INITIAL_EASE = 2.5;
const MIN_EASE = 1.3;
const BOX_DAYS = [1, 2, 4, 8, 16, 32];

function deckFile(library: Library) {
  return path.join(library.root, '.sophy', 'flashcards.json');
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function clampEase(value: number) {
  return round2(Math.max(MIN_EASE, value));
}

export function intervalLabel(days: number) {
  const rounded = Math.max(1, Math.round(days));
  if (rounded < 7) return `${rounded}d`;
  if (rounded < 30) return `${Math.max(1, Math.round(rounded / 7))}sem`;
  if (rounded < 365) return `${Math.max(1, Math.round(rounded / 30))}mês`;
  return `${Math.max(1, Math.round(rounded / 365))}a`;
}

function normalizeFront(front: string) {
  return front.normalize('NFC').trim().replace(/\s+/g, ' ');
}

function cardKey(noteKey: string, front: string, seen: Map<string, number>) {
  const digest = createHash('sha256').update(`${noteKey}\n${normalizeFront(front)}`).digest('hex').slice(0, 8);
  const base = `c_${digest}`;
  const count = (seen.get(base) ?? 0) + 1;
  seen.set(base, count);
  return count === 1 ? base : `${base}_${count}`;
}

function noteKeyOf(frontmatter: Record<string, unknown> | null, notePath: string) {
  return noteIdOf(frontmatter) ?? notePath.replace(/\\/g, '/');
}

function blankState(today: string): ScheduleState {
  return { due: today, interval: 0, ease: INITIAL_EASE, lapses: 0 };
}

function stateOf(entry: ScheduleEntry | undefined, today: string): ScheduleState {
  if (!entry) return blankState(today);
  return { due: entry.due, interval: entry.interval, ease: entry.ease, lapses: entry.lapses };
}

export function nextInterval(state: ScheduleState, grade: 1 | 2 | 3 | 4) {
  const ease = clampEase(state.ease);
  const interval = state.interval;
  if (grade === 1) {
    return { interval: 1, ease: clampEase(ease - 0.2), lapses: state.lapses + 1 };
  }
  if (grade === 2) {
    const base = interval < 1 ? 1 : interval;
    return { interval: round2(base * 1.2), ease: clampEase(ease - 0.15), lapses: state.lapses };
  }
  if (grade === 3) {
    const next = interval < 1 ? 1 : interval === 1 ? 3 : round2(interval * ease);
    return { interval: next, ease, lapses: state.lapses };
  }
  const base = interval < 1 ? 1 : interval;
  return { interval: round2(base * ease * 1.3), ease: clampEase(ease + 0.15), lapses: state.lapses };
}

function previewIntervals(state: ScheduleState): Record<1 | 2 | 3 | 4, string> {
  return {
    1: intervalLabel(nextInterval(state, 1).interval),
    2: intervalLabel(nextInterval(state, 2).interval),
    3: intervalLabel(nextInterval(state, 3).interval),
    4: intervalLabel(nextInterval(state, 4).interval),
  };
}

function resolveGrade(gradeOrKnew: boolean | number | undefined): 1 | 2 | 3 | 4 {
  if (typeof gradeOrKnew === 'boolean') return gradeOrKnew ? 3 : 1;
  if (typeof gradeOrKnew === 'number' && Number.isInteger(gradeOrKnew) && gradeOrKnew >= 1 && gradeOrKnew <= 4)
    return gradeOrKnew as 1 | 2 | 3 | 4;
  if (gradeOrKnew === undefined)
    throw new EngineError('invalid-note', 'Informe a nota da revisão (1 a 4).');
  throw new EngineError('invalid-note', 'A nota da revisão precisa ser um inteiro de 1 a 4.');
}

function asState(raw: unknown): ScheduleState | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.due)) return null;
  if (typeof entry.interval === 'number' && Number.isFinite(entry.interval)) {
    return {
      due: entry.due,
      interval: entry.interval,
      ease: typeof entry.ease === 'number' && Number.isFinite(entry.ease) ? clampEase(entry.ease) : INITIAL_EASE,
      lapses: typeof entry.lapses === 'number' && Number.isFinite(entry.lapses) ? entry.lapses : 0,
    };
  }
  if (typeof entry.box === 'number' && Number.isFinite(entry.box)) {
    const box = Math.max(0, Math.min(5, Math.floor(entry.box)));
    return {
      due: entry.due,
      interval: BOX_DAYS[box] ?? 1,
      ease: INITIAL_EASE,
      lapses: box === 0 ? 1 : 0,
    };
  }
  return { due: entry.due, interval: 0, ease: INITIAL_EASE, lapses: 0 };
}

function asEntry(raw: unknown): ScheduleEntry | null {
  const state = asState(raw);
  if (!state) return null;
  const previous = raw && typeof raw === 'object' ? asState((raw as { previous?: unknown }).previous) : null;
  return previous ? { ...state, previous } : state;
}

function oldIndex(key: string) {
  const normalized = key.replace(/\\/g, '/');
  const cut = normalized.lastIndexOf(':');
  if (cut <= 0) return null;
  const index = Number(normalized.slice(cut + 1));
  if (!Number.isInteger(index) || index < 1) return null;
  const notePath = normalized.slice(0, cut);
  if (!notePath || notePath.startsWith('c_')) return null;
  return { path: notePath, index };
}

function readSchedule(library: Library): Schedule {
  const file = deckFile(library);
  if (!fs.existsSync(file)) return {};
  let parsed: { cards?: Record<string, unknown>; cardIdsMigrated?: boolean };
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { cards?: Record<string, unknown>; cardIdsMigrated?: boolean };
  } catch {
    return {};
  }
  const cards: Schedule = {};
  for (const [key, value] of Object.entries(parsed.cards || {})) {
    const entry = asEntry(value);
    if (entry) cards[key.replace(/\\/g, '/')] = entry;
  }
  if (parsed.cardIdsMigrated) return cards;
  const consumed = new Set<string>();
  const take = (notePath: string, index: number) => {
    for (const key of Object.keys(cards)) {
      if (consumed.has(key)) continue;
      const old = oldIndex(key);
      if (!old || old.path !== notePath || old.index !== index) continue;
      consumed.add(key);
      return cards[key];
    }
    return undefined;
  };
  for (const note of listNotes(library)) {
    let doc;
    try {
      doc = readNote(library, note.path);
    } catch {
      continue;
    }
    const found = cardsInText(doc.body, note.path, note.workspace, '2000-01-01', noteKeyOf(doc.frontmatter, note.path));
    found.forEach((card, ordinal) => {
      if (cards[card.id]) return;
      const source = take(card.path, card.line) ?? take(card.path, ordinal + 1);
      if (source) cards[card.id] = source;
    });
  }
  for (const key of consumed) delete cards[key];
  writeSchedule(library, cards, true);
  return cards;
}

function writeSchedule(library: Library, cards: Schedule, migrated = true) {
  const dir = path.join(library.root, '.sophy');
  fs.mkdirSync(dir, { recursive: true });
  const stored: Record<string, ScheduleEntry> = {};
  for (const [key, entry] of Object.entries(cards)) {
    stored[key] = entry.previous ? entry : { due: entry.due, interval: entry.interval, ease: entry.ease, lapses: entry.lapses };
  }
  fs.writeFileSync(deckFile(library), `${JSON.stringify({ cardIdsMigrated: migrated, cards: stored }, null, 2)}\n`);
}

export function cardsInText(
  body: string,
  notePath: string,
  workspace: string | null,
  today: string,
  noteKey = notePath.replace(/\\/g, '/'),
) {
  const lines = String(body || '').split(/\r?\n/);
  const cards: StudyCard[] = [];
  const seen = new Map<string, number>();
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
    const front = match[1].trim();
    const state = blankState(today);
    cards.push({
      id: cardKey(noteKey, front, seen),
      path: notePath.replace(/\\/g, '/'),
      line: index + 1,
      front,
      back: match[2].trim(),
      workspace,
      due: state.due,
      interval: state.interval,
      ease: state.ease,
      lapses: state.lapses,
      intervals: previewIntervals(state),
      reversible: Boolean(triple),
    });
  });
  return cards;
}

function findCard(library: Library, id: string, today: string) {
  for (const note of listNotes(library)) {
    const doc = readNote(library, note.path);
    const card = cardsInText(doc.body, note.path, note.workspace, today, noteKeyOf(doc.frontmatter, note.path)).find(
      (item) => item.id === id,
    );
    if (card) return card;
  }
  return null;
}

export function listCards(library: Library, today: string, workspace?: string) {
  const schedule = readSchedule(library);
  const cards: StudyCard[] = [];
  for (const note of listNotes(library)) {
    if (workspace && note.workspace !== workspace) continue;
    const doc = readNote(library, note.path);
    for (const card of cardsInText(doc.body, note.path, note.workspace, today, noteKeyOf(doc.frontmatter, note.path))) {
      const state = stateOf(schedule[card.id], today);
      cards.push({ ...card, ...state, intervals: previewIntervals(state) });
    }
  }
  return cards;
}

export function reviewCard(library: Library, id: string, gradeOrKnew: boolean | number | undefined, today: string) {
  const grade = resolveGrade(gradeOrKnew);
  const card = findCard(library, id, today);
  if (!card) throw new EngineError('not-found', 'Cartão não encontrado.');
  const schedule = readSchedule(library);
  const current = stateOf(schedule[id], today);
  const next = nextInterval(current, grade);
  const due = addDays(today, next.interval);
  schedule[id] = {
    due,
    interval: next.interval,
    ease: next.ease,
    lapses: next.lapses,
    previous: current,
  };
  writeSchedule(library, schedule);
  const saved = stateOf(schedule[id], today);
  return { ...card, ...saved, grade, intervals: previewIntervals(saved) };
}

export function undoCard(library: Library, id: string) {
  const today = '2000-01-01';
  const card = findCard(library, id, today);
  if (!card) throw new EngineError('not-found', 'Cartão não encontrado.');
  const schedule = readSchedule(library);
  const entry = schedule[id];
  if (!entry?.previous)
    throw new EngineError('not-found', 'Não há revisão anterior deste cartão para desfazer.');
  const restored = entry.previous;
  schedule[id] = { ...restored };
  writeSchedule(library, schedule);
  return { ...card, ...restored, undone: true as const, intervals: previewIntervals(restored) };
}

function addDays(iso: string, days: number) {
  const whole = Math.max(1, Math.round(days));
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + whole);
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

export function listVersions(library: Library, focus?: string) {
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
      const notes = collectNotes(full);
      const chosen =
        (focus && notes.find((note) => note.relative === focus)) ||
        (focus && notes.find((note) => note.relative.endsWith(`/${focus}`))) ||
        notes[0];
      let preview = '';
      if (chosen) {
        const text = fs.readFileSync(chosen.full, 'utf8').replace(/^---[\s\S]*?---\n?/, '');
        preview = text.replace(/\s+/g, ' ').trim().slice(0, 240);
      }
      return { id: entry.name, label, bytes: dirSize(full), preview };
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
  const existing = fs.readdirSync(target).filter((name) => !name.startsWith('.'));
  const dir = existing.length ? path.join(target, `Sophy-site-${Date.now()}`) : target;
  if (dir !== target) fs.mkdirSync(dir, { recursive: true });
  const notes = listNotes(library);
  const used = new Set<string>();
  const pages = notes.map((note) => {
    const doc = readNote(library, note.path);
    let name = `${note.path.replace(/\.md$/i, '').replaceAll('/', '-')}.html`;
    let suffix = 2;
    while (used.has(name)) {
      name = `${note.path.replace(/\.md$/i, '').replaceAll('/', '-')}-${suffix}.html`;
      suffix += 1;
    }
    used.add(name);
    const html = pageHtml(note.path, doc.body, theme);
    fs.writeFileSync(path.join(dir, name), html);
    return { href: name, title: note.name.replace(/\.md$/i, '') };
  });
  const index = `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><title>Biblioteca</title>${siteStyle()}</head><body><h1>Biblioteca</h1><ul>${pages
    .map((page) => `<li><a href="${escape(page.href)}">${escape(page.title)}</a></li>`)
    .join('')}</ul></body></html>\n`;
  fs.writeFileSync(path.join(dir, 'index.html'), index);
  return { pages: pages.length, theme };
}

export function lightPaperHtml(title: string, body: string) {
  return pageHtml(title, body, 'light');
}

function siteInline(text: string) {
  return escape(text)
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target, label) => label || String(target).split('/').pop())
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function pageHtml(title: string, body: string, theme: 'light' | 'dark') {
  const source = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const blocks = source
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.length) return '';
      if (lines.every((line) => /^[-*] \[[ xX]\] /.test(line)))
        return `<ul>${lines
          .map((line) => {
            const task = line.match(/^[-*] \[([ xX])\] (.*)$/);
            return `<li>${task?.[1].toLowerCase() === 'x' ? '☑' : '☐'} ${siteInline(task?.[2] || '')}</li>`;
          })
          .join('')}</ul>`;
      if (lines.every((line) => /^[-*] /.test(line)))
        return `<ul>${lines.map((line) => `<li>${siteInline(line.slice(2))}</li>`).join('')}</ul>`;
      return lines
        .map((line) => {
          const heading = line.match(/^(#{1,6}) (.*)$/);
          if (heading) {
            const level = Math.min(6, heading[1].length + 1);
            return `<h${level}>${siteInline(heading[2])}</h${level}>`;
          }
          return `<p>${siteInline(line)}</p>`;
        })
        .join('');
    })
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
