import { randomUUID } from 'node:crypto';
import { EngineError } from './errors.ts';
import { createDirectory, readText, writeText, type Library } from './library.ts';
import { resolveInside } from './paths.ts';
import fs from 'node:fs';

/** JSON Canvas, o mesmo arquivo que o Obsidian abre. */
export type CanvasSide = 'top' | 'right' | 'bottom' | 'left';
export type CanvasEnd = 'none' | 'arrow';
export type CanvasNodeType = 'text' | 'file' | 'link' | 'group';

export type CanvasNode = {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
} & Record<string, unknown>;

export type CanvasEdge = {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: CanvasSide;
  toSide?: CanvasSide;
  fromEnd?: CanvasEnd;
  toEnd?: CanvasEnd;
  color?: string;
  label?: string;
} & Record<string, unknown>;

export type CanvasFile = {
  nodes: CanvasNode[];
  edges?: CanvasEdge[];
} & Record<string, unknown>;

const sides = new Set(['top', 'right', 'bottom', 'left']);
const ends = new Set(['none', 'arrow']);
const types = new Set(['text', 'file', 'link', 'group']);

export function parseCanvas(content: string): CanvasFile {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new EngineError('invalid-note', 'O canvas não é um JSON válido.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EngineError('invalid-note', 'O canvas precisa ser um objeto JSON.');
  const file = value as CanvasFile;
  if (!Array.isArray(file.nodes))
    throw new EngineError('invalid-note', 'O canvas precisa de uma lista de nós.');
  file.nodes.forEach(assertNode);
  if (file.edges !== undefined) {
    if (!Array.isArray(file.edges))
      throw new EngineError('invalid-note', 'As arestas do canvas precisam ser uma lista.');
    file.edges.forEach(assertEdge);
  }
  return file;
}

export function serializeCanvas(file: CanvasFile) {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function emptyCanvas(): CanvasFile {
  return { nodes: [], edges: [] };
}

export function readCanvas(library: Library, relative: string) {
  assertCanvasPath(relative);
  const { content, revision } = readText(library, relative);
  return { path: relative, revision, document: parseCanvas(content) };
}

export function createCanvas(library: Library, relative: string, document?: CanvasFile) {
  assertCanvasPath(relative);
  const file = document ? parseCanvas(serializeCanvas(document)) : emptyCanvas();
  const parts = relative.split('/');
  if (parts.length > 1) createDirectory(library, parts.slice(0, -1).join('/'));
  const full = resolveInside(library.root, relative, { allowMissing: true });
  if (fs.existsSync(full)) throw new EngineError('exists', 'O canvas já existe.');
  const content = serializeCanvas(file);
  fs.writeFileSync(full, content, { flag: 'wx' });
  return readCanvas(library, relative);
}

export function updateCanvas(
  library: Library,
  relative: string,
  document: CanvasFile,
  expectedRevision: string,
) {
  assertCanvasPath(relative);
  const file = parseCanvas(serializeCanvas(document));
  const content = serializeCanvas(file);
  const written = writeText(library, relative, content, expectedRevision);
  if (written.conflict) return { conflict: true as const, current: readCanvas(library, relative) };
  return { conflict: false as const, canvas: readCanvas(library, relative) };
}

export function putCanvasNode(
  library: Library,
  relative: string,
  node: CanvasNode,
  expectedRevision: string,
) {
  const current = readCanvas(library, relative);
  if (current.revision !== expectedRevision) return { conflict: true as const, current };
  assertNode(node);
  const nodes = current.document.nodes.filter((item) => item.id !== node.id);
  nodes.push(node);
  return updateCanvas(library, relative, { ...current.document, nodes }, expectedRevision);
}

export function removeCanvasNode(
  library: Library,
  relative: string,
  id: string,
  expectedRevision: string,
) {
  const current = readCanvas(library, relative);
  if (current.revision !== expectedRevision) return { conflict: true as const, current };
  const nodes = current.document.nodes.filter((item) => item.id !== id);
  const edges = (current.document.edges ?? []).filter(
    (edge) => edge.fromNode !== id && edge.toNode !== id,
  );
  return updateCanvas(library, relative, { ...current.document, nodes, edges }, expectedRevision);
}

export function putCanvasEdge(
  library: Library,
  relative: string,
  edge: CanvasEdge,
  expectedRevision: string,
) {
  const current = readCanvas(library, relative);
  if (current.revision !== expectedRevision) return { conflict: true as const, current };
  assertEdge(edge);
  const edges = (current.document.edges ?? []).filter((item) => item.id !== edge.id);
  edges.push(edge);
  return updateCanvas(library, relative, { ...current.document, edges }, expectedRevision);
}

export function removeCanvasEdge(
  library: Library,
  relative: string,
  id: string,
  expectedRevision: string,
) {
  const current = readCanvas(library, relative);
  if (current.revision !== expectedRevision) return { conflict: true as const, current };
  const edges = (current.document.edges ?? []).filter((edge) => edge.id !== id);
  return updateCanvas(library, relative, { ...current.document, edges }, expectedRevision);
}

export function newCanvasId() {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

function assertCanvasPath(relative: string) {
  if (!relative.toLowerCase().endsWith('.canvas'))
    throw new EngineError('invalid-path', 'O canvas precisa terminar em .canvas.');
}

function assertNode(value: unknown): asserts value is CanvasNode {
  if (!value || typeof value !== 'object')
    throw new EngineError('invalid-note', 'Nó de canvas inválido.');
  const node = value as CanvasNode;
  if (typeof node.id !== 'string' || !node.id)
    throw new EngineError('invalid-note', 'O nó do canvas precisa de id.');
  if (!types.has(node.type))
    throw new EngineError('invalid-note', 'Tipo de nó de canvas desconhecido.');
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (typeof node[key] !== 'number' || Number.isNaN(node[key]))
      throw new EngineError('invalid-note', 'O nó do canvas precisa de posição e tamanho.');
  }
}

function assertEdge(value: unknown): asserts value is CanvasEdge {
  if (!value || typeof value !== 'object')
    throw new EngineError('invalid-note', 'Aresta de canvas inválida.');
  const edge = value as CanvasEdge;
  if (typeof edge.id !== 'string' || !edge.id)
    throw new EngineError('invalid-note', 'A aresta do canvas precisa de id.');
  if (typeof edge.fromNode !== 'string' || typeof edge.toNode !== 'string')
    throw new EngineError('invalid-note', 'A aresta do canvas precisa ligar dois nós.');
  if (edge.fromSide !== undefined && !sides.has(edge.fromSide))
    throw new EngineError('invalid-note', 'Lado de aresta inválido.');
  if (edge.toSide !== undefined && !sides.has(edge.toSide))
    throw new EngineError('invalid-note', 'Lado de aresta inválido.');
  if (edge.fromEnd !== undefined && !ends.has(edge.fromEnd))
    throw new EngineError('invalid-note', 'Ponta de aresta inválida.');
  if (edge.toEnd !== undefined && !ends.has(edge.toEnd))
    throw new EngineError('invalid-note', 'Ponta de aresta inválida.');
}
