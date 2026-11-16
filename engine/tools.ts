import { z } from 'zod';
import { EngineError } from './errors.ts';
import {
  createDirectory,
  createNote,
  createWorkspace,
  listFiles,
  listNotes,
  listWorkspaces,
  moveEntry,
  openLibrary,
  readNote,
  trashEntry,
  writeNote,
} from './library.ts';

const libraryPath = z.string().min(1);
const relativePath = z.string().min(1);
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
 */
export const tools = [
  define(
    'library.open',
    'Abre a pasta de uma biblioteca e lista as estantes visíveis de primeiro nível.',
    z.object({ path: libraryPath }),
    ({ path }) => {
      const library = openLibrary(path);
      const workspaces = listWorkspaces(library);
      return { root: library.root, identity: library.identity, workspaces };
    },
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
    z.object({ libraryPath, name: z.string().min(1) }),
    ({ libraryPath: folder, name }) => createWorkspace(openLibrary(folder), name),
  ),
  define(
    'directory.create',
    'Cria uma pasta dentro da biblioteca, inclusive subpastas de uma estante.',
    z.object({ libraryPath, path: relativePath }),
    ({ libraryPath: folder, path }) => createDirectory(openLibrary(folder), path),
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
    }),
    ({ libraryPath: folder, path, body, frontmatter: matter }) =>
      createNote(openLibrary(folder), path, body ?? '', matter),
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
    }),
    ({ libraryPath: folder, path, body, frontmatter: matter, expectedRevision }) =>
      writeNote(openLibrary(folder), path, {
        body,
        frontmatter: matter,
        expectedRevision,
      }),
  ),
  define(
    'entry.move',
    'Move ou renomeia um arquivo ou pasta dentro da biblioteca. Não reescreve wikilinks nesta etapa.',
    z.object({ libraryPath, from: relativePath, to: relativePath }),
    ({ libraryPath: folder, from, to }) => moveEntry(openLibrary(folder), from, to),
  ),
  define(
    'entry.trash',
    'Move um arquivo ou pasta para a lixeira. Não apaga de forma permanente.',
    z.object({ libraryPath, path: relativePath }),
    ({ libraryPath: folder, path }) => trashEntry(openLibrary(folder), path),
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

function define<T>(
  name: string,
  description: string,
  input: z.ZodType<T>,
  run: (input: T) => unknown,
): Tool {
  return { name, description, input, run: run as (input: never) => unknown };
}
