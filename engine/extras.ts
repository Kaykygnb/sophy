import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EngineError } from './errors.ts';
import {
  listFiles,
  listNotes,
  readNote,
  readText,
  writeNote,
  type Library,
} from './library.ts';
import { resolveInside, validateSegment } from './paths.ts';

export type TemplateValues = { data: string; titulo: string; hora: string };

export function fillTemplate(body: string, values: TemplateValues) {
  const filled = body
    .replaceAll('{{data}}', values.data)
    .replaceAll('{{titulo}}', values.titulo)
    .replaceAll('{{hora}}', values.hora);
  const cursor = filled.indexOf('{{cursor}}');
  return { body: filled.replaceAll('{{cursor}}', ''), cursor: cursor < 0 ? filled.length : cursor };
}

function outsideMarkup(body: string) {
  return body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '').replace(/\[\[[^\]]*\]\]/g, '');
}

export function unlinkedMentions(library: Library) {
  const notes = listNotes(library).map((note) => ({
    path: note.path,
    title: note.name.replace(/\.md$/i, ''),
    body: readNote(library, note.path).body,
  }));
  return notes
    .filter((note) => note.title.length >= 4 && !/^\d{4}-\d{2}-\d{2}$/.test(note.title) && note.title.toLocaleLowerCase() !== 'capa')
    .map((note) => {
      const hits = notes
        .filter((other) => other.path !== note.path)
        .map((other) => ({
          path: other.path,
          count: countTitle(outsideMarkup(other.body), note.title),
        }))
        .filter((hit) => hit.count > 0);
      return { title: note.title, path: note.path, hits, total: hits.reduce((sum, hit) => sum + hit.count, 0) };
    })
    .filter((row) => row.total > 0);
}

function countTitle(text: string, title: string) {
  if (!title) return 0;
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu');
  return [...text.matchAll(pattern)].length;
}

export function linkMentions(library: Library, title: string) {
  if (!title || title.length < 4 || /^\d{4}-\d{2}-\d{2}$/.test(title))
    throw new EngineError('invalid-note', 'O título é curto demais para ligar.');
  let files = 0;
  let links = 0;
  for (const note of listNotes(library)) {
    if (note.name.replace(/\.md$/i, '') === title) continue;
    const current = readNote(library, note.path);
    const next = rewriteMentions(current.body, title);
    if (next.body === current.body) continue;
    const written = writeNote(library, note.path, { body: next.body, expectedRevision: current.revision });
    if (written.conflict) throw new EngineError('conflict', 'A nota mudou antes de ligar as menções.');
    files += 1;
    links += next.linked;
  }
  return { title, files, links };
}

function rewriteMentions(body: string, title: string) {
  const lines = body.split('\n');
  let fence = false;
  let linked = 0;
  const next = lines.map((line) => {
    if (line.trim().startsWith('```')) {
      fence = !fence;
      return line;
    }
    if (fence) return line;
    return line
      .split(/(\[\[[^\]]*\]\]|`[^`\n]*`)/)
      .map((part) => {
        if (part.startsWith('[[') || part.startsWith('`')) return part;
        return part.replaceAll(title, () => {
          linked += 1;
          return `[[${title}]]`;
        });
      })
      .join('');
  });
  return { body: next.join('\n'), linked };
}

export function importVault(library: Library, source: string, shelf: string) {
  validateSegment(shelf, 'workspace');
  const root = path.resolve(source);
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new EngineError('invalid-path', 'A origem da importação precisa ser uma pasta.');
  const libraryReal = fs.realpathSync(library.root);
  const sourceReal = fs.realpathSync(root);
  if (
    sourceReal === libraryReal ||
    sourceReal.startsWith(libraryReal + path.sep) ||
    libraryReal.startsWith(sourceReal + path.sep)
  )
    throw new EngineError('invalid-path', 'A importação não escreve na pasta de origem.');
  const before = sourceStamp(sourceReal);
  let copied = 0;
  const walk = (directory: string, relative: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const child = path.join(directory, entry.name);
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child, next);
      else if (/\.(md|canvas)$/i.test(entry.name)) {
        const relativeFile = `${shelf}/${next}`;
        ensureParents(library, relativeFile);
        const destination = resolveInside(library.root, relativeFile, { allowMissing: true });
        fs.copyFileSync(child, destination);
        copied += 1;
      }
    }
  };
  walk(sourceReal, '');
  if (sourceStamp(sourceReal) !== before)
    throw new EngineError('invalid-path', 'A importação alterou a pasta de origem.');
  return { copied, shelf };
}

function ensureParents(library: Library, relativeFile: string) {
  const parts = relativeFile.split('/');
  let parent = '';
  for (const part of parts.slice(0, -1)) {
    parent = parent ? `${parent}/${part}` : part;
    const full = resolveInside(library.root, parent, { allowMissing: true });
    if (!fs.existsSync(full)) fs.mkdirSync(full);
  }
}

function sourceStamp(root: string) {
  const hash = createHash('sha256');
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const child = path.join(directory, entry.name);
      hash.update(entry.name);
      if (entry.isDirectory()) walk(child);
      else hash.update(fs.readFileSync(child));
    }
  };
  walk(root);
  return hash.digest('hex');
}

export type SavedView = {
  nome: string;
  modo: 'lista' | 'quadro' | 'tabela';
  estante?: string;
  tag?: string;
};

export function listViews(library: Library) {
  return listFiles(library)
    .filter((file) => file.path.toLowerCase().endsWith('.view'))
    .map((file) => {
      try {
        const parsed = JSON.parse(readText(library, file.path).content) as SavedView;
        if (!parsed || typeof parsed.nome !== 'string') return null;
        return { path: file.path, nome: parsed.nome, modo: parsed.modo, estante: parsed.estante || '', tag: parsed.tag || '' };
      } catch {
        return null;
      }
    })
    .filter((view) => view !== null);
}

export function saveView(library: Library, relative: string, view: SavedView) {
  if (!relative.toLowerCase().endsWith('.view') || relative.split('/').some((part) => part.startsWith('.')))
    throw new EngineError('invalid-path', 'A visão precisa ser um arquivo .view visível.');
  if (!['lista', 'quadro', 'tabela'].includes(view.modo))
    throw new EngineError('invalid-note', 'A visão usa lista, quadro ou tabela.');
  const destination = resolveInside(library.root, relative, { allowMissing: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(view, null, 2)}\n`);
  return { path: relative, ...view };
}
