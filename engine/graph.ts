import { readOutgoing, syncLinks } from './links.ts';
import type { Library } from './library.ts';

export function queryGraph(library: Library, filter: { workspace?: string; tag?: string } = {}) {
  const tag = filter.tag?.trim().toLocaleLowerCase();
  const cache = syncLinks(library);
  const notes = [...cache.values()].filter((note) => {
    if (filter.workspace && note.workspace !== filter.workspace) return false;
    if (tag && !note.tags.some((item) => item.toLocaleLowerCase() === tag)) return false;
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
      edges.push({ from: note.path, to: link.path, format: link.format });
    }
  }
  return {
    nodes: notes.map((note) => ({
      path: note.path,
      title: note.title,
      workspace: note.workspace,
      tags: note.tags,
      modifiedAt: note.mtime,
    })),
    edges,
  };
}
