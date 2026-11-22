import { EngineError } from './errors.ts';
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
  content: string;
  files: ExportedAttachment[];
};

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
    return { format, path: relative, filename: `${title}.pdf`, content, files: [] };
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
    content: markdownWithoutId(raw),
    files,
  };
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
