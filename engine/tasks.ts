import { EngineError } from './errors.ts';
import { listNotes, readNote, readText, writeText, type Library } from './library.ts';
import { splitMarkdown } from './markdown.ts';

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

function priorityOf(suffix: string): TaskPriority | null {
  if (suffix.includes('⏫')) return 'alta';
  if (suffix.includes('🔼')) return 'media';
  if (suffix.includes('🔽')) return 'baixa';
  return null;
}

function dateOf(suffix: string, mark: string) {
  const match = suffix.match(new RegExp(`${mark}\\s*(\\d{4}-\\d{2}-\\d{2})`));
  return match ? match[1] : null;
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

export function rewriteTaskLine(line: string, patch: { status?: TaskStatus; due?: string | null }) {
  const match = line.match(/^(\s*(?:[-*+]|\d+\.) )\[([ xX/\-])\](.*)$/);
  if (!match) throw new EngineError('invalid-note', 'A linha não é uma tarefa.');
  const status = patch.status ? STATUS_CHAR[patch.status] : match[2];
  let rest = match[3];
  if (patch.due !== undefined) {
    if (/📅\s*\d{4}-\d{2}-\d{2}/.test(rest)) {
      rest = patch.due
        ? rest.replace(/📅\s*\d{4}-\d{2}-\d{2}/, `📅 ${patch.due}`)
        : rest.replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/, '');
    } else if (patch.due) rest = `${rest} 📅 ${patch.due}`;
  }
  return `${match[1]}[${status}]${rest}`;
}

export function updateTask(
  library: Library,
  relative: string,
  line: number,
  patch: { status?: TaskStatus; due?: string | null },
  expectedRevision: string,
) {
  const current = readText(library, relative);
  if (current.revision !== expectedRevision) {
    return { conflict: true as const, current: readNote(library, relative) };
  }
  const parts = current.content.split(/(\r?\n)/);
  let number = 1;
  let found = false;
  for (let index = 0; index < parts.length; index += 2) {
    if (number === line) {
      parts[index] = rewriteTaskLine(parts[index], patch);
      found = true;
      break;
    }
    number += 1;
  }
  if (!found) throw new EngineError('not-found', 'A tarefa não está nessa linha.');
  const next = parts.join('');
  const written = writeText(library, relative, next, expectedRevision);
  if (written.conflict) return { conflict: true as const, current: readNote(library, relative) };
  const workspace = relative.includes('/') ? relative.split('/')[0] : null;
  const task = scan(next, relative, workspace, written.revision).find((item) => item.line === line);
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

export function queryCalendar(library: Library, from: string, to: string) {
  const items: CalendarItem[] = [];
  for (const note of listNotes(library)) {
    let file;
    try {
      file = readText(library, note.path);
    } catch {
      continue;
    }
    const document = splitMarkdown(file.content);
    for (const task of scan(file.content, note.path, note.workspace, file.revision)) {
      for (const date of [task.due, task.scheduled]) {
        if (!date || date < from || date > to) continue;
        items.push({
          date,
          kind: 'tarefa',
          path: note.path,
          workspace: note.workspace,
          title: task.title,
          status: task.status,
          line: task.line,
          revision: task.revision,
        });
      }
    }
    const named = note.path.match(/(\d{4}-\d{2}-\d{2})\.md$/i);
    const heading = file.content.match(/^#{1,6}[ \t]+(.+)$/m);
    const title = heading ? heading[1].trim() : note.name.replace(/\.md$/i, '');
    if (named && named[1] >= from && named[1] <= to) {
      items.push({
        date: named[1],
        kind: 'nota',
        path: note.path,
        workspace: note.workspace,
        title,
      });
    }
    const matter = document.frontmatter || {};
    for (const field of ['data', 'prazo', 'inicio', 'fim'] as const) {
      const value = matter[field];
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) continue;
      const date = value.slice(0, 10);
      if (date < from || date > to) continue;
      items.push({
        date,
        kind: 'frontmatter',
        field,
        path: note.path,
        workspace: note.workspace,
        title: note.name.replace(/\.md$/i, ''),
      });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'pt-BR'));
}
