import { calendarSeeds } from './calendar-facts.ts';
import { EngineError } from './errors.ts';
import { syncLinks } from './links.ts';
import { listNotes, readNote, readText, writeText, type Library } from './library.ts';

export type TaskStatus = 'aberta' | 'andamento' | 'feita' | 'cancelada';
export type TaskPriority = 'alta' | 'media' | 'baixa';

export type TaskItem = {
  path: string;
  workspace: string | null;
  line: number;
  status: TaskStatus;
  title: string;
  due: string | null;
  scheduled: string | null;
  start: string | null;
  priority: TaskPriority | null;
  revision: string;
  indent: number;
  parentLine: number | null;
  childTotal: number;
  childDone: number;
};

export type TaskQuery = {
  status?: TaskStatus;
  priority?: TaskPriority;
  workspace?: string;
  due?: 'atrasada' | 'hoje' | 'semana' | 'sem';
  today?: string;
};

const STATUS_CHAR: Record<TaskStatus, string> = {
  aberta: ' ',
  andamento: '/',
  feita: 'x',
  cancelada: '-',
};

function statusOf(mark: string): TaskStatus {
  if (mark === '/') return 'andamento';
  if (mark === 'x' || mark === 'X') return 'feita';
  if (mark === '-') return 'cancelada';
  return 'aberta';
}

function stripVariant(text: string) {
  return String(text).replace(/\uFE0F/g, '');
}

function priorityOf(suffix: string): TaskPriority | null {
  const clean = stripVariant(suffix);
  if (clean.includes('⏫')) return 'alta';
  if (clean.includes('🔼')) return 'media';
  if (clean.includes('🔽')) return 'baixa';
  return null;
}

function dateOf(suffix: string, mark: string) {
  const clean = stripVariant(suffix);
  const match = clean.match(new RegExp(`${mark}\\s*(\\d{4}-\\d{2}-\\d{2})`));
  return match ? match[1] : null;
}

function indentOf(line: string) {
  return (line.match(/^(\s*)/) || [''])[0].length;
}

export function todayIso(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function addDays(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setDate(date.getDate() + days);
  return todayIso(date);
}

function parseLine(
  line: string,
  fileLine: number,
  path: string,
  workspace: string | null,
  revision: string,
): TaskItem | null {
  const match = line.match(/^(\s*)([-*+]|\d+\.) \[([ xX/\-])\]\s?(.*)$/);
  if (!match) return null;
  const rest = match[4];
  const emoji = rest.search(/📅|🛫|⏳|✅|⏫|🔼|🔽/);
  const title = (emoji < 0 ? rest : rest.slice(0, emoji)).replace(/\s+$/, '');
  const suffix = emoji < 0 ? '' : rest.slice(emoji);
  return {
    path,
    workspace,
    line: fileLine,
    status: statusOf(match[3]),
    title,
    due: dateOf(suffix, '📅'),
    scheduled: dateOf(suffix, '⏳'),
    start: dateOf(suffix, '🛫'),
    priority: priorityOf(suffix),
    revision,
    indent: indentOf(line),
    parentLine: null,
    childTotal: 0,
    childDone: 0,
  };
}

function scan(content: string, path: string, workspace: string | null, revision: string) {
  const tasks: TaskItem[] = [];
  let fence = false;
  content.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const task = parseLine(line, index + 1, path, workspace, revision);
    if (task) tasks.push(task);
  });
  const stack: TaskItem[] = [];
  for (const task of tasks) {
    while (stack.length && stack[stack.length - 1].indent >= task.indent) stack.pop();
    task.parentLine = stack.length ? stack[stack.length - 1].line : null;
    if (stack.length) {
      stack[stack.length - 1].childTotal += 1;
      if (task.status === 'feita') stack[stack.length - 1].childDone += 1;
    }
    stack.push(task);
  }
  return tasks;
}

function matches(task: TaskItem, query: TaskQuery, today: string, weekEnd: string) {
  if (query.status && task.status !== query.status) return false;
  if (query.priority && task.priority !== query.priority) return false;
  if (query.workspace && task.workspace !== query.workspace) return false;
  if (!query.due) return true;
  if (query.due === 'sem') return !task.due;
  if (!task.due) return false;
  if (query.due === 'hoje') return task.due === today;
  if (query.due === 'atrasada')
    return task.due < today && task.status !== 'feita' && task.status !== 'cancelada';
  return task.due >= today && task.due <= weekEnd;
}

export function listTasks(library: Library, query: TaskQuery = {}) {
  const today = query.today || todayIso();
  const weekEnd = addDays(today, 6);
  const tasks: TaskItem[] = [];
  for (const note of listNotes(library)) {
    try {
      const file = readText(library, note.path);
      tasks.push(...scan(file.content, note.path, note.workspace, file.revision));
    } catch {
      /* um item com nome inválido não esconde as tarefas das outras notas */
    }
  }
  return tasks.filter((task) => matches(task, query, today, weekEnd));
}

const PRIORITY_MARK: Record<TaskPriority, string> = {
  alta: '⏫',
  media: '🔼',
  baixa: '🔽',
};

export type TaskPatch = {
  status?: TaskStatus;
  due?: string | null;
  scheduled?: string | null;
  priority?: TaskPriority | null;
  title?: string;
};

function replaceMark(rest: string, mark: string, value: string | null | undefined) {
  if (value === undefined) return rest;
  const pattern = new RegExp(`\\s*${mark}\\uFE0F?\\s*\\d{4}-\\d{2}-\\d{2}`);
  if (pattern.test(rest)) {
    return value == null ? rest.replace(pattern, '') : rest.replace(pattern, ` ${mark} ${value}`);
  }
  return value == null ? rest : `${rest} ${mark} ${value}`;
}

export function rewriteTaskLine(line: string, patch: TaskPatch) {
  const match = line.match(/^(\s*(?:[-*+]|\d+\.) )\[([ xX/\-])\](.*)$/);
  if (!match) throw new EngineError('invalid-note', 'A linha não é uma tarefa.');
  const status = patch.status ? STATUS_CHAR[patch.status] : match[2];
  let rest = match[3];
  if (patch.title !== undefined) {
    const emoji = rest.search(/📅|🛫|⏳|✅|⏫|🔼|🔽/);
    const suffix = emoji < 0 ? '' : rest.slice(emoji);
    rest = `${patch.title.replace(/\s+$/, '')}${suffix ? ` ${suffix.trimStart()}` : ''}`;
  }
  rest = replaceMark(rest, '📅', patch.due);
  rest = replaceMark(rest, '⏳', patch.scheduled);
  if (patch.priority !== undefined) {
    rest = rest.replace(/\s*(?:⏫|🔼|🔽)\uFE0F?/g, '');
    if (patch.priority) rest = `${rest} ${PRIORITY_MARK[patch.priority]}`;
  }
  return `${match[1]}[${status}]${rest}`;
}

export function updateTask(
  library: Library,
  relative: string,
  line: number,
  patch: TaskPatch,
  expectedRevision: string,
  options: { titleHint?: string } = {},
) {
  const current = readText(library, relative);
  let targetLine = line;
  if (current.revision !== expectedRevision) {
    if (!options.titleHint) return { conflict: true as const, current: readNote(library, relative) };
    const matches = scan(current.content, relative, relative.includes('/') ? relative.split('/')[0] : null, current.revision).filter(
      (task) => task.title === options.titleHint,
    );
    if (matches.length !== 1) {
      return {
        conflict: true as const,
        current: readNote(library, relative),
        reason: 'task-moved' as const,
      };
    }
    targetLine = matches[0].line;
  }
  const parts = current.content.split(/(\r?\n)/);
  let number = 1;
  let found = false;
  for (let index = 0; index < parts.length; index += 2) {
    if (number === targetLine) {
      parts[index] = rewriteTaskLine(parts[index], patch);
      found = true;
      break;
    }
    number += 1;
  }
  if (!found) throw new EngineError('not-found', 'A tarefa não está nessa linha.');
  const next = parts.join('');
  const written = writeText(library, relative, next, current.revision);
  if (written.conflict) return { conflict: true as const, current: readNote(library, relative) };
  const workspace = relative.includes('/') ? relative.split('/')[0] : null;
  const task = scan(next, relative, workspace, written.revision).find((item) => item.line === targetLine);
  return { conflict: false as const, task, revision: written.revision };
}

export type CalendarItem = {
  date: string;
  kind: 'tarefa' | 'nota' | 'frontmatter';
  path: string;
  workspace: string | null;
  title: string;
  field?: string;
  status?: TaskStatus;
  line?: number;
  revision?: string;
};

export type CalendarDay = {
  date: string;
  total: number;
  byShelf: Record<string, number>;
  openTasks: number;
};

const calendarCache = new Map<
  string,
  Map<string, { mtime: number; size: number; revision: string; seeds: ReturnType<typeof calendarSeeds> }>
>();
const calendarReads = new Map<string, number>();

/** Leituras de conteúdo feitas pelo calendário. Trocar de mês não aumenta se nada mudou. */
export function calendarFileReads(root: string) {
  return calendarReads.get(root) ?? 0;
}

export function queryCalendar(library: Library, from: string, to: string) {
  const index = syncLinks(library);
  const bucket = calendarCache.get(library.root) ?? new Map();
  calendarCache.set(library.root, bucket);
  const seen = new Set<string>();
  const raw: CalendarItem[] = [];
  for (const note of index.values()) {
    if (!note.path.toLowerCase().endsWith('.md')) continue;
    seen.add(note.path);
    let cached = bucket.get(note.path);
    if (!cached || cached.mtime !== note.mtime || cached.size !== note.size) {
      let file;
      try {
        file = readText(library, note.path);
      } catch {
        bucket.delete(note.path);
        continue;
      }
      calendarReads.set(library.root, (calendarReads.get(library.root) ?? 0) + 1);
      cached = {
        mtime: note.mtime,
        size: note.size,
        revision: file.revision,
        seeds: calendarSeeds(note.path, file.content, note.title),
      };
      bucket.set(note.path, cached);
    }
    for (const seed of cached.seeds) {
      if (seed.date < from || seed.date > to) continue;
      raw.push({
        date: seed.date,
        kind: seed.kind,
        path: note.path,
        workspace: note.workspace,
        title: seed.title,
        field: seed.field,
        status: seed.status,
        line: seed.line,
        revision: cached.revision,
      });
    }
  }
  for (const path of bucket.keys()) if (!seen.has(path)) bucket.delete(path);
  const groups = new Map<string, CalendarItem[]>();
  for (const item of raw) {
    const key = `${item.path}\0${item.date}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const items: CalendarItem[] = [];
  for (const list of groups.values()) {
    const task = list.find((item) => item.kind === 'tarefa');
    const note = list.find((item) => item.kind === 'nota');
    items.push(task || note || list[0]);
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'pt-BR'));
  const byDate = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const list = byDate.get(item.date) ?? [];
    list.push(item);
    byDate.set(item.date, list);
  }
  const days: CalendarDay[] = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => {
      const byShelf: Record<string, number> = {};
      for (const item of list) {
        const shelf = item.workspace || 'Biblioteca';
        byShelf[shelf] = (byShelf[shelf] || 0) + 1;
      }
      const open = new Set<string>();
      for (const item of raw) {
        if (item.date !== date || item.kind !== 'tarefa') continue;
        if (item.status === 'feita' || item.status === 'cancelada') continue;
        open.add(`${item.path}:${item.line}`);
      }
      return { date, total: list.length, byShelf, openTasks: open.size };
    });
  return { items, days };
}
