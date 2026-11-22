import path from 'node:path';
import { EngineError } from './errors.ts';
import { MAX_ATTACHMENT_BYTES } from './limits.ts';
import {
  attachmentMime,
  listAttachmentFiles,
  readAttachmentBytes,
  readNote,
  readText,
  referencedAttachments,
  type Library,
} from './library.ts';
import { composeMarkdown, prefixFromFrontmatter, splitMarkdown } from './markdown.ts';
import { contains } from './paths.ts';
import { lightPaperHtml } from './study.ts';

/**
 * Exportação de uma nota para fora da biblioteca.
 *
 * `md` devolve o Markdown sem a chave `id` do frontmatter. Os outros campos
 * ficam. Anexos citados em `Anexos/` acompanham em `files` (bytes em base64),
 * no mesmo caminho relativo, para serem gravados ao lado do `.md`. Embutir
 * data URL no texto deixaria o arquivo pesado e ilegível; copiar junto é o
 * caminho mais simples. O motor não abre diálogo e não altera a nota.
 *
 * `pdf` devolve o HTML de `lightPaperHtml` (papel claro, `data-theme="light"`).
 * Quem grava o arquivo é `sophy:export-pdf`, que já abre o diálogo de salvar.
 * Esse HTML não embute binário, então `files` fica vazio.
 */
const MAX_PDF_HTML_CHARS = 2_000_000;

export type ExportedAttachment = {
  path: string;
  name: string;
  mime: string;
  bytesBase64: string;
};

export type NoteExport = {
  format: 'md' | 'pdf';
  path: string;
  filename: string;
  /** Nome sugerido no diálogo de salvar. No Markdown é o título do arquivo, como `Ideia.md`. */
  suggestedName: string;
  content: string;
  files: ExportedAttachment[];
};

export type ExportChoice = 'replace' | 'keep-both' | 'cancel';

export type MarkdownWrite = {
  absolute: string;
  /** Caminho relativo à pasta escolhida, com `/`. */
  relative: string;
  /** `note` ou o `path` original do anexo. */
  source: string;
  /** Verdadeiro só quando a escolha foi substituir um arquivo que já existia. */
  replace: boolean;
};

export type MarkdownPlan =
  | { ok: false; error: string }
  | { ok: true; action: 'choose'; conflicts: string[] }
  | { ok: true; action: 'cancel' }
  | { ok: true; action: 'write'; path: string; writes: MarkdownWrite[] };

export function exportNote(library: Library, relative: string, format: 'md' | 'pdf'): NoteExport {
  if (format !== 'md' && format !== 'pdf')
    throw new EngineError('invalid-path', 'Formato de exportação desconhecido. Use md ou pdf.');
  const note = readNote(library, relative, { ensureId: false });
  const raw = readText(library, relative).content;
  if (format === 'pdf') {
    const title = note.name.replace(/\.md$/i, '');
    const content = lightPaperHtml(title, note.body);
    if (content.length > MAX_PDF_HTML_CHARS)
      throw new EngineError('too-large', 'O HTML do PDF passa de 2 MB.');
    const filename = `${title}.pdf`;
    return { format, path: relative, filename, suggestedName: filename, content, files: [] };
  }
  const known = new Set(listAttachmentFiles(library).map((file) => file.path));
  const files = referencedAttachments(raw, known).map((filePath) => {
    const name = filePath.split('/').pop() || filePath;
    return {
      path: filePath,
      name,
      mime: attachmentMime(name),
      bytesBase64: readAttachmentBytes(library, filePath).toString('base64'),
    };
  });
  return {
    format,
    path: relative,
    filename: note.name,
    suggestedName: note.name,
    content: markdownWithoutId(raw),
    files,
  };
}

/** Nome do `.md` no diálogo. Pasta no texto vira só o arquivo, e a extensão entra se faltar. */
export function suggestMarkdownName(name?: string) {
  const raw = typeof name === 'string' ? name.trim() : '';
  const base = path.basename(raw.replaceAll('\\', '/'));
  const clean = base.replace(/[\x00-\x1f<>:"|?*]/g, '').replace(/[. ]+$/g, '');
  const file = !clean || clean === '.' || clean === '..' ? 'nota' : clean;
  return file.toLowerCase().endsWith('.md') ? file : `${file}.md`;
}

/**
 * Decide onde gravar o Markdown e os anexos. Não lê disco: `exists` diz o que já
 * está na pasta. Caminho com `..`, absoluto ou barra invertida é recusado.
 * Sem `choice`, conflito devolve `choose`. `keep-both` usa o primeiro sufixo livre `(2)`, `(3)`, …
 */
export function planMarkdownExport(input: {
  directory: string;
  noteFile: string;
  files: string[];
  exists?: (absolute: string) => boolean;
  choice?: ExportChoice;
}): MarkdownPlan {
  if (typeof input.directory !== 'string' || !input.directory)
    return { ok: false, error: 'Pasta de destino inválida.' };
  if (typeof input.noteFile !== 'string' || !input.noteFile)
    return { ok: false, error: 'Arquivo Markdown inválido.' };
  if (input.choice && input.choice !== 'replace' && input.choice !== 'keep-both' && input.choice !== 'cancel')
    return { ok: false, error: 'Escolha de conflito inválida.' };
  const directory = path.resolve(input.directory);
  const noteFile = path.resolve(input.noteFile);
  if (!contains(directory, noteFile) || path.dirname(noteFile) !== directory)
    return { ok: false, error: 'O Markdown precisa ficar na pasta escolhida.' };
  const noteName = path.basename(noteFile);
  if (!safeExportName(noteName)) return { ok: false, error: 'Nome de arquivo inválido.' };

  const relatives: string[] = [];
  const seen = new Set<string>();
  for (const file of input.files) {
    const relative = exportFileRelative(file);
    if (!relative) return { ok: false, error: 'O anexo precisa ficar na pasta escolhida.' };
    if (seen.has(relative)) return { ok: false, error: 'Anexo repetido na exportação.' };
    seen.add(relative);
    if (!insideDirectory(directory, relative))
      return { ok: false, error: 'O anexo precisa ficar na pasta escolhida.' };
    relatives.push(relative);
  }
  if (input.choice === 'cancel') return { ok: true, action: 'cancel' };

  const exists = input.exists ?? (() => false);
  const notePlaced = placeExport(directory, noteName, exists, input.choice);
  if (!notePlaced) return { ok: false, error: 'Não há nome livre para manter os dois.' };
  const filePlaced = [];
  for (const relative of relatives) {
    const placed = placeExport(directory, relative, exists, input.choice);
    if (!placed) return { ok: false, error: 'Não há nome livre para manter os dois.' };
    filePlaced.push({ ...placed, source: relative });
  }
  const taken = new Set<string>();
  for (const item of [notePlaced, ...filePlaced]) {
    if (taken.has(item.absolute))
      return { ok: false, error: 'Dois arquivos da exportação cairiam no mesmo caminho.' };
    taken.add(item.absolute);
  }
  if (!input.choice) {
    const conflicts = [notePlaced, ...filePlaced].filter((item) => item.existed).map((item) => item.relative);
    if (conflicts.length) return { ok: true, action: 'choose', conflicts };
  }
  return {
    ok: true,
    action: 'write',
    path: notePlaced.absolute,
    writes: [
      { absolute: notePlaced.absolute, relative: notePlaced.relative, source: 'note', replace: notePlaced.replace },
      ...filePlaced.map((item) => ({
        absolute: item.absolute,
        relative: item.relative,
        source: item.source,
        replace: item.replace,
      })),
    ],
  };
}

/** Bytes do anexo que veio em `files`. Recusa base64 inválido e arquivo acima de 25 MB. */
export function decodeExportBytes(encoded: string) {
  if (typeof encoded !== 'string' || encoded.length > MAX_ATTACHMENT_BYTES * 2)
    throw new EngineError('invalid-path', 'Anexo da exportação inválido.');
  if (encoded && !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
    throw new EngineError('invalid-path', 'Anexo da exportação inválido.');
  const data = Buffer.from(encoded, 'base64');
  if (data.length > MAX_ATTACHMENT_BYTES)
    throw new EngineError('too-large', 'O anexo ultrapassa o limite de 25 MB.');
  return data;
}

export function exportFileRelative(value: unknown) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) return null;
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) return null;
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  if (parts.some((part) => !safeExportName(part))) return null;
  return parts.join('/');
}

/** Tira só o `id` do topo. Frontmatter inválido perde a linha `id:`; o corpo fica. */
function markdownWithoutId(content: string) {
  const parts = splitMarkdown(content);
  if (!parts.prefix) return content;
  if (parts.frontmatter && 'id' in parts.frontmatter) {
    const rest = { ...parts.frontmatter };
    delete rest.id;
    return composeMarkdown({
      bom: parts.bom,
      prefix: prefixFromFrontmatter(rest),
      body: parts.body,
    });
  }
  if (!parts.frontmatterError) return content;
  return parts.bom + stripTopLevelId(parts.prefix) + parts.body;
}

function safeExportName(name: string) {
  return Boolean(name) && name !== '.' && name !== '..' && !/[<>:"|?*\x00-\x1f\\/]/.test(name);
}

function insideDirectory(directory: string, relative: string) {
  const absolute = path.resolve(directory, ...relative.split('/'));
  return contains(directory, absolute) && absolute !== directory;
}

function placeExport(
  directory: string,
  relative: string,
  exists: (absolute: string) => boolean,
  choice?: ExportChoice,
) {
  const absolute = path.resolve(directory, ...relative.split('/'));
  const existed = exists(absolute);
  if (!existed || choice !== 'keep-both') {
    return { absolute, relative, existed, replace: Boolean(existed && choice === 'replace') };
  }
  const parts = relative.split('/');
  const name = parts[parts.length - 1];
  const prefix = parts.slice(0, -1);
  for (let index = 2; index < 100; index += 1) {
    const nextRelative = [...prefix, suffixExportName(name, index)].join('/');
    const nextAbsolute = path.resolve(directory, ...nextRelative.split('/'));
    if (!insideDirectory(directory, nextRelative)) return null;
    if (!exists(nextAbsolute))
      return { absolute: nextAbsolute, relative: nextRelative, existed: true, replace: false };
  }
  return null;
}

function suffixExportName(name: string, index: number) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length) || name;
  return `${stem} (${index})${ext}`;
}

function stripTopLevelId(prefix: string) {
  const match = prefix.match(/^(---\r?\n)([\s\S]*?)\r?\n---(\r?\n)?$/);
  if (!match) return prefix;
  const yaml = match[2]
    .split(/\r?\n/)
    .filter((line) => !/^id\s*:/.test(line))
    .join('\n');
  if (!yaml.trim()) return '';
  const closing = match[3] ?? '\n';
  return `---\n${yaml}\n---${closing}`;
}
