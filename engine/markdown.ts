import { parse, stringify } from 'yaml';
import { EngineError } from './errors.ts';

export type MarkdownParts = {
  bom: string;
  /** Bloco `---...---` original, inclusive a quebra de linha que o fecha. Nulo sem frontmatter. */
  prefix: string | null;
  frontmatter: Record<string, unknown> | null;
  frontmatterError: string | null;
  body: string;
};

/**
 * Separa frontmatter YAML e corpo. O corpo é a fatia exata do arquivo:
 * `[[` permanece `[[`. O campo `notas1_editor`, se existir, fica no mapa
 * e não altera o corpo.
 */
export function splitMarkdown(content: string): MarkdownParts {
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const source = bom ? content.slice(1) : content;
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n'))
    return { bom, prefix: null, frontmatter: null, frontmatterError: null, body: source };
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { bom, prefix: null, frontmatter: null, frontmatterError: null, body: source };
  let end = match[0].length;
  if (source[end] === '\r') end += 1;
  if (source[end] === '\n') end += 1;
  const prefix = source.slice(0, end);
  const body = source.slice(end);
  try {
    const parsed = parse(match[1], { schema: 'core', maxAliasCount: 0 });
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {
        bom,
        prefix,
        frontmatter: null,
        frontmatterError: 'O frontmatter precisa ser um mapa YAML.',
        body,
      };
    return {
      bom,
      prefix,
      frontmatter: plainRecord(parsed),
      frontmatterError: null,
      body,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Frontmatter inválido.';
    return { bom, prefix, frontmatter: null, frontmatterError: message, body };
  }
}

export function composeMarkdown(parts: { bom: string; prefix: string | null; body: string }) {
  return parts.bom + (parts.prefix ?? '') + parts.body;
}

/** Mapa vazio ou nulo remove o frontmatter. O corpo é concatenado sem escape. */
export function prefixFromFrontmatter(frontmatter: Record<string, unknown> | null) {
  if (!frontmatter || Object.keys(frontmatter).length === 0) return null;
  let yaml = stringify(frontmatter, { lineWidth: 0, schema: 'core' });
  if (yaml.endsWith('\n')) yaml = yaml.slice(0, -1);
  return `---\n${yaml}\n---\n`;
}

function plainRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function assertBody(body: unknown): asserts body is string {
  if (typeof body !== 'string')
    throw new EngineError('invalid-note', 'O corpo da nota precisa ser texto.');
}
