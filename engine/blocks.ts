import fs from 'node:fs';
import { parseCanvas, serializeCanvas } from './canvas.ts';
import { EngineError } from './errors.ts';
import { listFiles, listNotes, readText, type Library } from './library.ts';
import { splitMarkdown } from './markdown.ts';
import { resolveInside } from './paths.ts';
import {
  anchorKey,
  headingsOf,
  posixPath,
  resolvePath,
  scan,
  sectionsOf,
} from './wikilinks.ts';

/** Até 40 linhas de código na prévia de `links.resolve`. */
export const BLOCK_PREVIEW_LINES = 40;

export type NamedBlock = {
  title: string;
  lang: string;
  startLine: number;
  endLine: number;
  duplicate?: true;
};

type RichBlock = NamedBlock & { code: string };

const FENCE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;

/**
 * Blocos nomeados: a linguagem é a primeira palavra da info string
 * depois de tirar `title="..."` (aspas duplas, em qualquer posição).
 * Cercas sem title não entram na lista, mas continuam escondendo o miolo.
 */
export function namedBlocksOf(source: string): NamedBlock[] {
  return parseNamedBlocks(source).map(({ code: _code, ...block }) => block);
}

export function findNamedBlock(source: string, anchor: string): RichBlock | null {
  const wanted = anchorKey(anchor);
  if (!wanted) return null;
  return parseNamedBlocks(source).find((block) => anchorKey(block.title) === wanted && !block.duplicate) ?? null;
}

export function blockCode(source: string, block: { startLine: number; endLine: number }) {
  const found = parseNamedBlocks(source).find(
    (item) => item.startLine === block.startLine && item.endLine === block.endLine,
  );
  return found?.code ?? '';
}

function editorLines(source: string) {
  const lines = source.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '' && /\r?\n$/.test(source)) lines.pop();
  return lines;
}

function parseNamedBlocks(source: string): RichBlock[] {
  const lines = editorLines(source);
  const blocks: RichBlock[] = [];
  let open: { char: string; len: number; start: number; title: string; lang: string } | null = null;
  const startAt = frontmatterEnd(lines);
  for (let index = startAt; index < lines.length; index += 1) {
    const line = lines[index].replace(/^\uFEFF/, '');
    const marker = line.match(FENCE);
    if (open) {
      const closes = marker && marker[2][0] === open.char && marker[2].length >= open.len;
      if (!closes) continue;
      if (open.title) blocks.push(finish(lines, open, index + 1, true));
      open = null;
      continue;
    }
    if (!marker) continue;
    const info = marker[3] ?? '';
    const titleMatch = info.match(/title="([^"]*)"/);
    const rawTitle = titleMatch ? titleMatch[1].trim() : '';
    const title = rawTitle && anchorKey(rawTitle) ? rawTitle : '';
    const lang = info.replace(/title="[^"]*"/g, ' ').trim().split(/\s+/)[0] || '';
    open = {
      char: marker[2][0],
      len: marker[2].length,
      start: index + 1,
      title,
      lang: title ? lang : '',
    };
  }
  if (open?.title) blocks.push(finish(lines, open, lines.length, false));
  const seen = new Set<string>();
  for (const block of blocks) {
    const key = anchorKey(block.title);
    if (seen.has(key)) block.duplicate = true;
    else seen.add(key);
  }
  return blocks;
}

function finish(
  lines: string[],
  open: { start: number; title: string; lang: string },
  endLine: number,
  closed: boolean,
): RichBlock {
  const sliceEnd = closed ? endLine - 1 : endLine;
  const code = lines.slice(open.start, Math.max(open.start, sliceEnd)).join('\n');
  return {
    title: open.title,
    lang: open.lang,
    startLine: open.start,
    endLine,
    code,
  };
}

function frontmatterEnd(lines: string[]) {
  const first = (lines[0] ?? '').replace(/^\uFEFF/, '');
  if (first !== '---') return 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') return index + 1;
  }
  return 0;
}

export function previewLines(code: string, limit = BLOCK_PREVIEW_LINES) {
  if (!code) return { preview: '', truncated: false };
  const lines = code.split('\n');
  const truncated = lines.length > limit;
  return { preview: (truncated ? lines.slice(0, limit) : lines).join('\n'), truncated };
}

function assertTitle(value: string) {
  const title = value.trim();
  if (!title || /["\r\n#|[\]\\]/.test(title))
    throw new EngineError(
      'invalid-note',
      'O novo nome não pode ser vazio nem conter aspas, #, |, barra ou colchetes.',
    );
  return title;
}

/**
 * Troca o title da cerca e reescreve `[[Nota#de]]` e `[[Nota#de|alias]]`
 * nesta nota e nas outras. Se `para` já é seção ou bloco, não grava nada.
 */
export function renameNamedBlock(library: Library, notePath: string, from: string, to: string) {
  const relative = posixPath(notePath);
  if (!relative.toLowerCase().endsWith('.md'))
    throw new EngineError('invalid-note', 'Somente arquivos Markdown podem ser editados.');
  const nextTitle = assertTitle(to);
  const fromKey = anchorKey(from);
  if (!fromKey) throw new EngineError('not-found', 'Bloco nomeado não encontrado.');
  const original = readText(library, relative).content;
  const parts = splitMarkdown(original);
  const blocks = namedBlocksOf(original);
  const target = blocks.find((block) => anchorKey(block.title) === fromKey && !block.duplicate);
  if (!target) throw new EngineError('not-found', 'Bloco nomeado não encontrado.');
  const takenBySection = headingsOf(parts.body).some((heading) => anchorKey(heading) === anchorKey(nextTitle));
  const takenByBlock = blocks.some(
    (block) => block.startLine !== target.startLine && anchorKey(block.title) === anchorKey(nextTitle),
  );
  if (takenBySection || takenByBlock)
    throw new EngineError('nome_em_uso', 'Esse nome já é uma seção ou um bloco desta nota.');
  const sectionOwns = headingsOf(parts.body).some((heading) => anchorKey(heading) === fromKey);
  const notes = listNotes(library).map((note) => note.path);
  const writes: Array<{ path: string; next: string }> = [];
  const renamed = sectionOwns
    ? original
    : rewriteAnchors(original, relative, notes, relative, fromKey, nextTitle);
  const nextSource = replaceFenceTitle(renamed, target.startLine, nextTitle);
  if (nextSource !== original) writes.push({ path: relative, next: nextSource });
  if (!sectionOwns) {
    for (const note of notes) {
      if (note === relative) continue;
      try {
        const content = readText(library, note).content;
        const next = rewriteAnchors(content, note, notes, relative, fromKey, nextTitle);
        if (next !== content) writes.push({ path: note, next });
      } catch (error) {
        if (error instanceof EngineError && error.code === 'conflict') throw error;
      }
    }
    for (const file of listFiles(library)) {
      if (file.kind !== 'canvas') continue;
      try {
        const content = readText(library, file.path).content;
        const next = rewriteCanvasAnchors(content, file.path, notes, relative, fromKey, nextTitle);
        if (next !== content) writes.push({ path: file.path, next });
      } catch (error) {
        if (error instanceof EngineError && error.code === 'conflict') throw error;
      }
    }
  }
  for (const write of writes) {
    fs.writeFileSync(resolveInside(library.root, write.path), write.next);
  }
  return {
    path: relative,
    title: nextTitle,
    from: target.title,
    updated: writes.map((write) => write.path),
    shadowed: sectionOwns,
  };
}

function replaceFenceTitle(content: string, lineNumber: number, title: string) {
  const parts = content.split(/(\r?\n)/);
  let line = 1;
  for (let index = 0; index < parts.length; index += 2) {
    if (line === lineNumber) {
      if (!/title="[^"]*"/.test(parts[index]))
        throw new EngineError('not-found', 'Não encontrei o título na cerca do bloco.');
      parts[index] = parts[index].replace(/title="[^"]*"/, `title="${title}"`);
      return parts.join('');
    }
    if (index + 1 < parts.length) line += 1;
  }
  throw new EngineError('not-found', 'Não encontrei o título na cerca do bloco.');
}

export function rewriteAnchors(
  content: string,
  source: string,
  notePaths: string[],
  targetNote: string,
  fromKey: string,
  toTitle: string,
) {
  const refs = scan(content);
  if (!refs.length) return content;
  let result = content;
  for (const ref of [...refs].reverse()) {
    if (!ref.anchor || ref.anchor.startsWith('^')) continue;
    if (anchorKey(ref.anchor) !== fromKey) continue;
    const resolved = ref.note
      ? resolvePath(ref.note, source, notePaths)
      : { path: source, candidates: [source], invalid: false };
    if (resolved.path !== targetNote) continue;
    const value = ref.note + '#' + toTitle + (ref.alias !== null ? '|' + ref.alias : '');
    const open = ref.format === 'embed' ? '![[' : '[[';
    result = result.slice(0, ref.start) + open + value + ']]' + result.slice(ref.end);
  }
  return result;
}

function rewriteCanvasAnchors(
  content: string,
  source: string,
  notePaths: string[],
  targetNote: string,
  fromKey: string,
  toTitle: string,
) {
  let file;
  try {
    file = parseCanvas(content);
  } catch {
    return content;
  }
  let changed = false;
  for (const node of file.nodes) {
    if (node.type !== 'text' || typeof node.text !== 'string') continue;
    const next = rewriteAnchors(node.text, source, notePaths, targetNote, fromKey, toTitle);
    if (next !== node.text) {
      node.text = next;
      changed = true;
    }
  }
  return changed ? serializeCanvas(file) : content;
}

export function sectionText(body: string, anchor: string) {
  const wanted = anchorKey(anchor);
  const section = sectionsOf(body).find((item) => anchorKey(item.title) === wanted);
  if (section) return body.slice(section.start, section.end).replace(/\s+$/, '');
  const heading = headingsOf(body).find((item) => anchorKey(item) === wanted);
  return heading || '';
}

export function unwrapWiki(target: string) {
  const text = target.trim();
  const match = text.match(/^!?\[\[([\s\S]+)\]\]$/);
  return match ? match[1] : text;
}
