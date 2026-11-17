import { z } from 'zod';
import { EngineError } from './errors.ts';
import { queryGraph } from './graph.ts';
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
