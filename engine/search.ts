import { indexedNotes } from './links.ts';
import type { Library } from './library.ts';
import { matchesTagFilter, type TagFilter } from './tags.ts';

export function fold(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

export function searchLibrary(
  library: Library,
  query: string,
  workspace?: string,
  tags: TagFilter = {},
) {
  const needle = fold(query.trim());
  if (needle.length < 2) return [];
  const hits = [];
  for (const note of indexedNotes(library)) {
    if (workspace && note.workspace !== workspace) continue;
    if (!matchesTagFilter(note.tagRecords, tags)) continue;
    const fields: Array<[string, string]> = [
      ['title', note.title],
      ['body', note.plain],
      ['tag', note.tags.join('\n')],
      ['frontmatter', note.frontmatterText],
    ];
    for (const [field, text] of fields) {
      const folded = fold(text);
      const index = folded.indexOf(needle);
      if (index < 0) continue;
      hits.push({
        path: note.path,
        title: note.title,
        workspace: note.workspace,
        field,
        segments: segments(text, index, needle.length),
      });
    }
  }
  return hits;
}

function segments(text: string, start: number, length: number) {
  const from = Math.max(0, start - 48);
  const to = Math.min(text.length, start + length + 48);
  const parts = [];
  if (from < start) parts.push({ text: text.slice(from, start), match: false });
  parts.push({ text: text.slice(start, start + length), match: true });
  if (start + length < to) parts.push({ text: text.slice(start + length, to), match: false });
  return parts;
}
