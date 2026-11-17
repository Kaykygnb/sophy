import { z } from 'zod';
import {
  createCanvas,
  putCanvasEdge,
  putCanvasNode,
  readCanvas,
  removeCanvasEdge,
  removeCanvasNode,
  updateCanvas,
  type CanvasEdge,
  type CanvasFile,
  type CanvasNode,
} from './canvas.ts';
import { EngineError } from './errors.ts';
import { queryGraph } from './graph.ts';
import { readShelfStyles, writeShelfStyle } from './shelves.ts';
import { listTasks, queryCalendar, updateTask, type TaskStatus } from './tasks.ts';
import { capture, diff, listHistory, pushHistory, undoLast, type Origin } from './history.ts';
import { backlinks, brokenLinks, outgoingLinks, relocate, watchLibrary } from './links.ts';
import {
  createDirectory,
  createNote,
  createWorkspace,
  listFiles,
  listNotes,
  listWorkspaces,
  openLibrary,
  readNote,
  trashEntry,
  writeNote,
  type Library,
} from './library.ts';
import { searchLibrary } from './search.ts';
import { requestUi } from './ui-bridge.ts';

const libraryPath = z.string().min(1);
const relativePath = z.string().min(1);
const origin = z.enum(['ui', 'cli', 'mcp', 'agent']);
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);
const frontmatter = z.record(z.string(), jsonValue);
const canvasSide = z.enum(['top', 'right', 'bottom', 'left']);
const canvasNode = z.looseObject({
  id: z.string().min(1),
  type: z.enum(['text', 'file', 'link', 'group']),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  color: z.string().optional(),
  text: z.string().optional(),
  file: z.string().optional(),
  url: z.string().optional(),
  label: z.string().optional(),
});
const canvasEdge = z.looseObject({
  id: z.string().min(1),
  fromNode: z.string().min(1),
  toNode: z.string().min(1),
  fromSide: canvasSide.optional(),
  toSide: canvasSide.optional(),
  fromEnd: z.enum(['none', 'arrow']).optional(),
  toEnd: z.enum(['none', 'arrow']).optional(),
  color: z.string().optional(),
  label: z.string().optional(),
});
const canvasDocument = z.looseObject({
  nodes: z.array(canvasNode),
  edges: z.array(canvasEdge).optional(),
});

export type Tool = {
  name: string;
  description: string;
  input: z.ZodType;
  run: (input: never) => unknown;
};

/**
 * Registro único das operações do motor. CLI, MCP, UI e o agente futuro
 * chamam estes nomes. `library` é a Biblioteca; `workspace` é a Estante.
 * Tools que alteram arquivos exigem `origin`: ui, cli, mcp ou agent.
 */
export const tools = [
  define(
    'library.open',
    'Abre a pasta de uma biblioteca e lista as estantes visíveis de primeiro nível.',
    z.object({ path: libraryPath }),
    ({ path }) => {
      const library = openLibrary(path);
      return {
        root: library.root,
        identity: library.identity,
        workspaces: listWorkspaces(library),
      };
    },
  ),
  define(
    'library.watch',
    'Liga ou desliga o watcher da pasta. Mudança externa em .md invalida o índice de links.',
    z.object({ libraryPath, enabled: z.boolean() }),
    ({ libraryPath: folder, enabled }) => watchLibrary(openLibrary(folder), enabled),
  ),
  define(
    'workspace.list',
    'Lista as estantes: cada subpasta visível de primeiro nível da biblioteca.',
    z.object({ libraryPath }),
    ({ libraryPath: folder }) => listWorkspaces(openLibrary(folder)),
  ),
  define(
    'workspace.create',
    'Cria uma estante como subpasta visível de primeiro nível. Não sobrescreve.',
    z.object({ libraryPath, name: z.string().min(1), origin }),
    ({ libraryPath: folder, name, origin: source }) =>
      tracked(folder, source, 'workspace.create', `Criar estante ${name}`, (library) =>
        createWorkspace(library, name),
      ),
  ),
  define(
    'directory.create',
    'Cria uma pasta dentro da biblioteca, inclusive subpastas de uma estante.',
    z.object({ libraryPath, path: relativePath, origin }),
    ({ libraryPath: folder, path, origin: source }) =>
      tracked(folder, source, 'directory.create', `Criar pasta ${path}`, (library) =>
        createDirectory(library, path),
      ),
  ),
  define(
    'note.list',
    'Lista notas. Nota é somente arquivo .md. Sem workspace, inclui a raiz e todas as estantes.',
    z.object({ libraryPath, workspace: z.string().min(1).optional() }),
    ({ libraryPath: folder, workspace }) => listNotes(openLibrary(folder), workspace),
  ),
  define(
    'file.list',
    'Lista canvases .canvas e os demais arquivos visíveis como anexos. Não lê nem embrulha o conteúdo.',
    z.object({ libraryPath, workspace: z.string().min(1).optional() }),
    ({ libraryPath: folder, workspace }) => listFiles(openLibrary(folder), workspace),
  ),
  define(
    'note.read',
    'Lê uma nota. O corpo é o Markdown exato. A revisão precisa ser reenviada na escrita.',
    z.object({ libraryPath, path: relativePath }),
    ({ libraryPath: folder, path }) => readNote(openLibrary(folder), path),
  ),
  define(
    'note.create',
    'Cria uma nota .md. Não sobrescreve. O corpo é gravado sem transformação.',
    z.object({
      libraryPath,
      path: relativePath,
      body: z.string().optional(),
      frontmatter: frontmatter.nullable().optional(),
      origin,
    }),
    ({ libraryPath: folder, path, body, frontmatter: matter, origin: source }) =>
      tracked(folder, source, 'note.create', `Criar ${path}`, (library) =>
        createNote(library, path, body ?? '', matter),
      ),
  ),
  define(
    'note.write',
    'Substitui o corpo se a revisão ainda for a última leitura. Frontmatter omitido é preservado, inclusive notas1_editor.',
    z.object({
      libraryPath,
      path: relativePath,
      body: z.string(),
      frontmatter: frontmatter.nullable().optional(),
      expectedRevision: z.string().length(64),
      origin,
    }),
    ({ libraryPath: folder, path, body, frontmatter: matter, expectedRevision, origin: source }) =>
      tracked(folder, source, 'note.write', `Gravar ${path}`, (library) =>
        writeNote(library, path, { body, frontmatter: matter, expectedRevision }),
      ),
  ),
  define(
    'entry.move',
    'Move ou renomeia um arquivo ou pasta e reescreve os wikilinks que apontavam para ele.',
    z.object({ libraryPath, from: relativePath, to: relativePath, origin }),
    ({ libraryPath: folder, from, to, origin: source }) =>
      tracked(folder, source, 'entry.move', `Mover ${from} para ${to}`, (library) =>
        relocate(library, from, to),
      ),
  ),
  define(
    'entry.trash',
    'Move um arquivo ou pasta para a lixeira. Não apaga de forma permanente.',
    z.object({ libraryPath, path: relativePath, origin }),
    ({ libraryPath: folder, path, origin: source }) =>
      tracked(folder, source, 'entry.trash', `Lixeira ${path}`, (library) =>
        trashEntry(library, path),
      ),
  ),
  define(
    'links.outgoing',
    'Lista os wikilinks de uma nota, com status resolvido, ambíguo ou quebrado.',
    z.object({ libraryPath, path: relativePath }),
    ({ libraryPath: folder, path }) => outgoingLinks(openLibrary(folder), path),
  ),
  define(
    'links.backlinks',
    'Lista as notas que apontam para esta.',
    z.object({ libraryPath, path: relativePath }),
    ({ libraryPath: folder, path }) => backlinks(openLibrary(folder), path),
  ),
  define(
    'links.broken',
    'Lista links quebrados ou ambíguos da biblioteca.',
    z.object({ libraryPath }),
    ({ libraryPath: folder }) => brokenLinks(openLibrary(folder)),
  ),
  define(
    'search.query',
    'Busca em título, corpo em texto limpo, tags e frontmatter. O trecho vem em segmentos, sem Markdown cru.',
    z.object({ libraryPath, query: z.string().min(1), workspace: z.string().min(1).optional() }),
    ({ libraryPath: folder, query, workspace }) =>
      searchLibrary(openLibrary(folder), query, workspace),
  ),
  define(
    'graph.query',
    'Grafo em dados: nós e arestas. A UI desenha. Filtra por estante e tag.',
    z.object({
      libraryPath,
      workspace: z.string().min(1).optional(),
      tag: z.string().min(1).optional(),
    }),
    ({ libraryPath: folder, workspace, tag }) =>
      queryGraph(openLibrary(folder), { workspace, tag }),
  ),
  define(
    'history.list',
    'Lista as ações ainda desfazíveis, da mais recente para a mais antiga.',
    z.object({ libraryPath }),
    ({ libraryPath: folder }) => listHistory(openLibrary(folder)),
  ),
  define(
    'history.undo',
    'Desfaz a última ação registrada, se os arquivos ainda estão como essa ação deixou.',
    z.object({ libraryPath, origin }),
    ({ libraryPath: folder, origin: source }) => {
      const library = openLibrary(folder);
      const undone = undoLast(library);
      return { ...undone, requestedBy: source };
    },
  ),
  define(
    'shelf.style.list',
    'Lê a cor e o ícone escolhidos de cada estante, gravados em .sophy/estantes.json.',
    z.object({ libraryPath }),
    ({ libraryPath: folder }) => readShelfStyles(openLibrary(folder)),
  ),
  define(
    'shelf.style.set',
    'Grava a cor (1 a 8) e o ícone de uma estante. A Entrada não recebe cor.',
    z.object({
      libraryPath,
      name: z.string().min(1),
      color: z.number().int().min(1).max(8),
      icon: z.string().min(1),
      origin,
    }),
    ({ libraryPath: folder, name, color, icon, origin: source }) =>
      tracked(folder, source, 'shelf.style.set', `Estilo ${name}`, (library) =>
        writeShelfStyle(library, name, { color, icon }),
      ),
  ),
  define(
    'task.query',
    'Lista as tarefas de todas as notas, com filtro de status, prazo, prioridade e estante.',
    z.object({
      libraryPath,
      status: z.enum(['aberta', 'andamento', 'feita', 'cancelada']).optional(),
      priority: z.enum(['alta', 'media', 'baixa']).optional(),
      workspace: z.string().min(1).optional(),
      due: z.enum(['atrasada', 'hoje', 'semana', 'sem']).optional(),
      today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    ({ libraryPath: folder, ...query }) => listTasks(openLibrary(folder), query),
  ),
  define(
    'task.update',
    'Muda o status ou o prazo de uma tarefa na linha do Markdown. Exige a revisão da nota.',
    z.object({
      libraryPath,
      path: relativePath,
      line: z.number().int().positive(),
      status: z.enum(['aberta', 'andamento', 'feita', 'cancelada']).optional(),
      due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      expectedRevision: z.string().length(64),
      origin,
    }),
    ({ libraryPath: folder, path, line, status, due, expectedRevision, origin: source }) =>
      tracked(folder, source, 'task.update', `Tarefa ${path}:${line}`, (library) =>
        updateTask(library, path, line, { status: status as TaskStatus | undefined, due }, expectedRevision),
      ),
  ),
  define(
    'calendar.query',
    'Lista notas datadas, prazos e datas do frontmatter entre dois dias.',
    z.object({
      libraryPath,
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
    ({ libraryPath: folder, from, to }) => queryCalendar(openLibrary(folder), from, to),
  ),
  define(
    'canvas.read',
    'Lê um arquivo .canvas (JSON Canvas). A revisão volta na escrita.',
    z.object({ libraryPath, path: relativePath }),
    ({ libraryPath: folder, path }) => readCanvas(openLibrary(folder), path),
  ),
  define(
    'canvas.create',
    'Cria um .canvas vazio ou com o documento enviado. Não sobrescreve.',
    z.object({ libraryPath, path: relativePath, document: canvasDocument.optional(), origin }),
    ({ libraryPath: folder, path, document, origin: source }) =>
      tracked(folder, source, 'canvas.create', `Criar canvas ${path}`, (library) =>
        createCanvas(library, path, document as CanvasFile | undefined),
      ),
  ),
  define(
    'canvas.update',
    'Substitui o JSON Canvas se a revisão ainda for a última leitura.',
    z.object({
      libraryPath,
      path: relativePath,
      document: canvasDocument,
      expectedRevision: z.string().length(64),
      origin,
    }),
    ({ libraryPath: folder, path, document, expectedRevision, origin: source }) =>
      tracked(folder, source, 'canvas.update', `Gravar canvas ${path}`, (library) =>
        updateCanvas(library, path, document as CanvasFile, expectedRevision),
      ),
  ),
  define(
    'canvas.node.put',
    'Cria ou substitui um nó do canvas (texto, arquivo, link ou grupo).',
    z.object({
      libraryPath,
      path: relativePath,
      node: canvasNode,
      expectedRevision: z.string().length(64),
      origin,
    }),
    ({ libraryPath: folder, path, node, expectedRevision, origin: source }) =>
      tracked(folder, source, 'canvas.node.put', `Nó em ${path}`, (library) =>
        putCanvasNode(library, path, node as CanvasNode, expectedRevision),
      ),
  ),
  define(
    'canvas.node.remove',
    'Remove um nó do canvas e as arestas que saíam ou chegavam nele.',
    z.object({
      libraryPath,
      path: relativePath,
      id: z.string().min(1),
      expectedRevision: z.string().length(64),
      origin,
    }),
    ({ libraryPath: folder, path, id, expectedRevision, origin: source }) =>
      tracked(folder, source, 'canvas.node.remove', `Remover nó de ${path}`, (library) =>
        removeCanvasNode(library, path, id, expectedRevision),
      ),
  ),
  define(
    'canvas.edge.put',
    'Cria ou substitui uma aresta do canvas, com lados e pontas.',
    z.object({
      libraryPath,
      path: relativePath,
      edge: canvasEdge,
      expectedRevision: z.string().length(64),
      origin,
    }),
    ({ libraryPath: folder, path, edge, expectedRevision, origin: source }) =>
      tracked(folder, source, 'canvas.edge.put', `Aresta em ${path}`, (library) =>
        putCanvasEdge(library, path, edge as CanvasEdge, expectedRevision),
      ),
  ),
  define(
    'canvas.edge.remove',
    'Remove uma aresta do canvas.',
    z.object({
      libraryPath,
      path: relativePath,
      id: z.string().min(1),
      expectedRevision: z.string().length(64),
      origin,
    }),
    ({ libraryPath: folder, path, id, expectedRevision, origin: source }) =>
      tracked(folder, source, 'canvas.edge.remove', `Remover aresta de ${path}`, (library) =>
        removeCanvasEdge(library, path, id, expectedRevision),
      ),
  ),
  define(
    'ui.openNote',
    'Pede à interface aberta para mostrar uma nota. Não lê segredos nem altera o arquivo.',
    z.object({ libraryPath, path: relativePath }),
    ({ libraryPath: folder, path }) => {
      openLibrary(folder);
      return requestUi({ type: 'openNote', libraryPath: folder, path });
    },
  ),
  define(
    'ui.openCanvas',
    'Pede à interface aberta para mostrar um canvas .canvas.',
    z.object({ libraryPath, path: relativePath }),
    ({ libraryPath: folder, path }) => {
      openLibrary(folder);
      return requestUi({ type: 'openCanvas', libraryPath: folder, path });
    },
  ),
  define(
    'ui.showGraph',
    'Pede à interface aberta para mostrar o grafo.',
    z.object({ libraryPath, workspace: z.string().min(1).optional() }),
    ({ libraryPath: folder, workspace }) => {
      openLibrary(folder);
      return requestUi({ type: 'showGraph', libraryPath: folder, workspace });
    },
  ),
  define(
    'ui.setTheme',
    'Pede à interface aberta para usar o tema claro ou escuro.',
    z.object({ theme: z.enum(['light', 'dark']) }),
    ({ theme }) => requestUi({ type: 'setTheme', theme }),
  ),
] as const;

export function listTools() {
  return tools.map((tool) => ({ name: tool.name, description: tool.description }));
}

export function callTool(name: string, raw: unknown) {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new EngineError('not-found', `Tool desconhecida: ${name}.`);
  return tool.run(tool.input.parse(raw) as never);
}

function tracked<T>(
  folder: string,
  source: Origin,
  tool: string,
  summary: string,
  run: (library: Library) => T,
) {
  const library = openLibrary(folder);
  const before = capture(library);
  const result = run(library);
  pushHistory(library, { origin: source, tool, summary, changes: diff(before, capture(library)) });
  return result;
}

function define<T>(
  name: string,
  description: string,
  input: z.ZodType<T>,
  run: (input: T) => unknown,
): Tool {
  return { name, description, input, run: run as (input: never) => unknown };
}
