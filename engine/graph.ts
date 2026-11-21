import { EngineError } from './errors.ts';
import { readOutgoing, syncLinks } from './links.ts';
import type { Library } from './library.ts';
import type { LinkFormat } from './wikilinks.ts';

export type GraphNode = {
  path: string;
  title: string;
  workspace: string | null;
  tags: string[];
  modifiedAt: number;
  /** Links que chegam, somando `weight`. Conta links, não pares distintos. */
  degreeIn: number;
  /** Links que saem, somando `weight`. Conta links, não pares distintos. */
  degreeOut: number;
  /** Verdadeiro quando `degreeIn + degreeOut` é zero entre os nós devolvidos. */
  orphan: boolean;
  /** Links de saída quebrados ou ambíguos, um por ocorrência. */
  broken: number;
};

export type GraphEdge = {
  from: string;
  to: string;
  /** Formato do primeiro link encontrado para o par. Os seguintes só aumentam `weight`. */
  format: LinkFormat;
  /** Quantidade de links daquele par direcionado. Sempre >= 1. */
  weight: number;
};

export type GraphQuery = {
  workspace?: string;
  tag?: string;
  /** Caminho da nota no centro do subgrafo. */
  center?: string;
  /**
   * Saltos a partir de `center`, de 1 a 3. Padrão 1 quando há `center`.
   * Sem `center`, o grafo filtrado inteiro é devolvido.
   */
  depth?: number;
};

/**
 * Grafo da biblioteca. O formato antigo permanece: cada nó traz
 * `path`, `title`, `workspace`, `tags` e `modifiedAt`; cada aresta traz
 * `from`, `to` e `format`. Os campos novos são aditivos.
 *
 * Arestas resolvidas, sem self-link e com os dois lados visíveis, são
 * agregadas por par direcionado `(from, to)`. `weight` é a quantidade de
 * links; `format` fica o do primeiro.
 *
 * `degreeIn` e `degreeOut` somam esses weights nas arestas devolvidas
 * (links, não pares). `orphan` olha só essa soma. `broken` conta, na nota,
 * cada link de saída quebrado ou ambíguo — inclusive os que não viram aresta.
 *
 * `workspace` e `tag` filtram os nós antes da vizinhança. Com `center`,
 * a resposta é o subgrafo induzido até `depth` saltos: a busca trata a
 * aresta como não direcionada, e a aresta devolvida mantém a direção.
 * Qualquer caminho dentro de `.sophy/` fica de fora.
 */
export function queryGraph(library: Library, filter: GraphQuery = {}) {
  const tag = filter.tag?.trim().toLocaleLowerCase();
  const center = filter.center?.trim() || undefined;
  const depth = center ? (filter.depth ?? 1) : filter.depth;
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 1 || depth > 3))
    throw new EngineError('invalid-argument', 'depth precisa ser um inteiro de 1 a 3.');
  const cache = syncLinks(library);
  const indexed = [...cache.values()].filter((note) => !insideSophy(note.path));
  const notes = indexed.filter((note) => {
    if (filter.workspace && note.workspace !== filter.workspace) return false;
    if (tag && !note.tags.some((item) => item.toLocaleLowerCase() === tag)) return false;
    return true;
  });
  if (center) {
    if (!indexed.some((note) => note.path === center))
      throw new EngineError('not-found', 'A nota central não existe.');
    if (!notes.some((note) => note.path === center))
      throw new EngineError(
        'not-found',
        'A nota central está fora do filtro de estante ou tag.',
      );
  }
  const visible = new Set(notes.map((note) => note.path));
  let edges = aggregateEdges(library, cache, notes, visible);
  let selected = notes;
  if (center) {
    const neighborhood = neighborhoodOf(center, edges, depth ?? 1);
    selected = notes.filter((note) => neighborhood.has(note.path));
    edges = edges.filter((edge) => neighborhood.has(edge.from) && neighborhood.has(edge.to));
  }
  const degreeIn = new Map<string, number>();
  const degreeOut = new Map<string, number>();
  for (const edge of edges) {
    degreeOut.set(edge.from, (degreeOut.get(edge.from) ?? 0) + edge.weight);
    degreeIn.set(edge.to, (degreeIn.get(edge.to) ?? 0) + edge.weight);
  }
  return {
    nodes: selected.map((note) => {
      const incoming = degreeIn.get(note.path) ?? 0;
      const outgoing = degreeOut.get(note.path) ?? 0;
      return {
        path: note.path,
        title: note.title,
        workspace: note.workspace,
        tags: note.tags,
        modifiedAt: note.mtime,
        degreeIn: incoming,
        degreeOut: outgoing,
        orphan: incoming + outgoing === 0,
        broken: brokenCount(library, cache, note.path),
      };
    }),
    edges,
  };
}

function aggregateEdges(
  library: Library,
  cache: ReturnType<typeof syncLinks>,
  notes: Array<{ path: string }>,
  visible: Set<string>,
) {
  const edges: GraphEdge[] = [];
  const byPair = new Map<string, GraphEdge>();
  for (const note of notes) {
    for (const link of readOutgoing(library, cache, note.path)) {
      if (
        link.status !== 'resolved' ||
        !link.path ||
        link.path === note.path ||
        !visible.has(link.path)
      )
        continue;
      const key = `${note.path}\0${link.path}`;
      const existing = byPair.get(key);
      if (existing) {
        existing.weight += 1;
        continue;
      }
      const edge: GraphEdge = {
        from: note.path,
        to: link.path,
        format: link.format,
        weight: 1,
      };
      byPair.set(key, edge);
      edges.push(edge);
    }
  }
  return edges;
}

function brokenCount(
  library: Library,
  cache: ReturnType<typeof syncLinks>,
  relative: string,
) {
  let count = 0;
  for (const link of readOutgoing(library, cache, relative)) {
    if (link.status === 'broken' || link.status === 'ambiguous') count += 1;
  }
  return count;
}

/** Vizinhança não direcionada. A direção fica nas arestas, não nesta busca. */
function neighborhoodOf(center: string, edges: GraphEdge[], depth: number) {
  const adjacent = new Map<string, string[]>();
  const connect = (from: string, to: string) => {
    const list = adjacent.get(from);
    if (list) list.push(to);
    else adjacent.set(from, [to]);
  };
  for (const edge of edges) {
    connect(edge.from, edge.to);
    connect(edge.to, edge.from);
  }
  const seen = new Set<string>([center]);
  let frontier = [center];
  for (let hop = 0; hop < depth; hop += 1) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbor of adjacent.get(node) ?? []) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return seen;
}

function insideSophy(filePath: string) {
  return filePath.split('/').includes('.sophy');
}
