import { isMother, listChildren } from './children.ts';
import { EngineError } from './errors.ts';
import { readOutgoing, syncLinks } from './links.ts';
import type { Library } from './library.ts';
import { matchesTagFilter, type TagFilter } from './tags.ts';

export function queryGraph(
  library: Library,
  filter: { workspace?: string; from?: string; to?: string } & TagFilter = {},
) {
  const fromMs = filter.from ? parseBound(filter.from, false) : null;
  const toMs = filter.to ? parseBound(filter.to, true) : null;
  const cache = syncLinks(library);
  const notes = [...cache.values()].filter((note) => {
    if (filter.workspace && note.workspace !== filter.workspace) return false;
    if (!matchesTagFilter(note.tagRecords, filter)) return false;
    if (fromMs !== null || toMs !== null) {
      const created = parseBound(note.createdAt, false);
      if (fromMs !== null && created < fromMs) return false;
      if (toMs !== null && created > toMs) return false;
    }
    return true;
  });
  const visible = new Set(notes.map((note) => note.path));
  const edges = [];
  for (const note of notes) {
    for (const link of readOutgoing(library, cache, note.path)) {
      if (
        link.status !== 'resolved' ||
        !link.path ||
        link.path === note.path ||
        !visible.has(link.path)
      )
        continue;
      const edge: {
        from: string;
        to: string;
        format: string;
        target?: { kind: 'section' | 'block'; anchor: string };
      } = { from: note.path, to: link.path, format: link.format };
      if (link.anchor && (link.kind === 'section' || link.kind === 'block'))
        edge.target = { kind: link.kind, anchor: link.anchor };
      edges.push(edge);
    }
    if (isMother(library, note.path)) {
      for (const child of listChildren(library, note.path)) {
        if (!visible.has(child)) continue;
        edges.push({ from: note.path, to: child, format: 'child' as const });
      }
    }
  }
  return {
    nodes: notes.map((note) => ({
      path: note.path,
      title: note.title,
      workspace: note.workspace,
      tags: note.tags,
      modifiedAt: note.mtime,
      createdAt: note.createdAt,
    })),
    edges,
  };
}

/** `AAAA-MM-DD` cobre o dia inteiro. Data com hora é o instante, no fuso local se não houver fuso. */
function parseBound(value: string, end: boolean) {
  const text = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = new Date(year, month - 1, day, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
      throw new EngineError('invalid-path', 'Data inválida. Use AAAA-MM-DD ou uma data ISO.');
    return date.getTime();
  }
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (local) {
    const year = Number(local[1]);
    const month = Number(local[2]);
    const day = Number(local[3]);
    const date = new Date(year, month - 1, day, Number(local[4]), Number(local[5]), Number(local[6]));
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
      throw new EngineError('invalid-path', 'Data inválida. Use AAAA-MM-DD ou uma data ISO.');
    return date.getTime();
  }
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed))
    throw new EngineError('invalid-path', 'Data inválida. Use AAAA-MM-DD ou uma data ISO.');
  return parsed;
}
