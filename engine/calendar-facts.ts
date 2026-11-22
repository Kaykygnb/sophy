import { dailyDate } from './daily.ts';
import { splitMarkdown } from './markdown.ts';

export type CalendarSeed = {
  date: string;
  kind: 'tarefa' | 'nota' | 'frontmatter';
  title: string;
  field?: string;
  status?: 'aberta' | 'andamento' | 'feita' | 'cancelada';
  line?: number;
};

function statusOf(mark: string): CalendarSeed['status'] {
  if (mark === '/') return 'andamento';
  if (mark === 'x' || mark === 'X') return 'feita';
  if (mark === '-') return 'cancelada';
  return 'aberta';
}

function dateOf(suffix: string, mark: string) {
  const match = suffix.match(new RegExp(`${mark}\\s*(\\d{4}-\\d{2}-\\d{2})`));
  return match ? match[1] : null;
}

/**
 * Fatos de calendário de uma nota já lida. A data da nota do dia vem do nome:
 * o campo `data:` do frontmatter não cria outro dia.
 */
export function calendarSeeds(relative: string, content: string, fallbackTitle: string): CalendarSeed[] {
  const seeds: CalendarSeed[] = [];
  const document = splitMarkdown(content);
  const heading = content.match(/^#{1,6}[ \t]+(.+)$/m);
  const title = heading ? heading[1].trim() : fallbackTitle;
  let fence = false;
  content.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const match = line.match(/^(\s*)([-*+]|\d+\.) \[([ xX/\-])\]\s?(.*)$/);
    if (!match) return;
    const rest = match[4];
    const emoji = rest.search(/📅|🛫|⏳|✅|⏫|🔼|🔽/);
    const taskTitle = (emoji < 0 ? rest : rest.slice(0, emoji)).replace(/\s+$/, '');
    const suffix = emoji < 0 ? '' : rest.slice(emoji);
    const dates = new Set<string>();
    const due = dateOf(suffix, '📅');
    const scheduled = dateOf(suffix, '⏳');
    if (due) dates.add(due);
    if (scheduled) dates.add(scheduled);
    for (const date of dates) {
      seeds.push({
        date,
        kind: 'tarefa',
        title: taskTitle,
        status: statusOf(match[3]),
        line: index + 1,
      });
    }
  });
  const daily = dailyDate(relative);
  const named = relative.match(/(\d{4}-\d{2}-\d{2})\.md$/i);
  const noteDate = daily || (named ? named[1] : null);
  if (noteDate) seeds.push({ date: noteDate, kind: 'nota', title });
  const matter = document.frontmatter || {};
  for (const field of ['data', 'prazo', 'inicio', 'fim'] as const) {
    if (daily && field === 'data') continue;
    const value = matter[field];
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) continue;
    seeds.push({
      date: value.slice(0, 10),
      kind: 'frontmatter',
      field,
      title: fallbackTitle,
    });
  }
  return seeds;
}
