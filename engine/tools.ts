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
import { createChildNote, isMother, listChildren } from './children.ts';
import { EngineError } from './errors.ts';
import { queryGraph } from './graph.ts';
import { importVault, linkMentions, listViews, saveView, unlinkedMentions } from './extras.ts';
import { readShelfStyles, writeShelfStyle } from './shelves.ts';
import {
  enableSemantic,
  exportSite,
  listCards,
  listVersions,
  restoreVersion,
  reviewCard,
  saveVersionPoint,
  semanticSearch,
  undoCard,
  weeklyReview,
} from './study.ts';
import { listTasks, queryCalendar, updateTask, type TaskStatus } from './tasks.ts';
import { capture, diff, listHistory, pushHistory, undoById, undoLast, type Origin } from './history.ts';
import {
  deletePermanent,
  emptyTrash,
  listTrash,
  purgeTrash,
  restoreTrash,
  TRASH_ID,
  trashEntry,
} from './lixeira.ts';
import {
  backlinks,
  brokenLinks,
  catalogNotes,
  outgoingLinks,
  relocate,
  suggestNotes,
  watchLibrary,
} from './links.ts';
import {
  createDirectory,
  createNote,
  createWorkspace,
  importAttachmentBytes,
  importAttachmentFromPath,
  listFiles,
  listNotes,
  listWorkspaces,
  openLibrary,
  readAttachmentDataUrl,
  readNote,
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
    'attachment.import',
    'Copia arquivos ou bytes para a biblioteca como anexos (imagens e outros).',
    z.object({
      libraryPath,
      origin,
      folder: z.string().optional(),
      files: z
        .array(
          z.object({
            name: z.string().min(1).optional(),
            path: z.string().min(1).optional(),
            dataBase64: z.string().min(1).optional(),
          }),
        )
        .min(1)
        .max(40),
    }),
    ({ libraryPath: folder, origin: source, folder: dest, files }) =>
      tracked(folder, source, 'attachment.import', `Importar ${files.length} anexo(s)`, (library) => {
        const added = [];
        for (const file of files) {
          if (file.path) {
            added.push(importAttachmentFromPath(library, file.path, dest || ''));
            continue;
          }
          if (!file.dataBase64 || !file.name)
            throw new EngineError('invalid-path', 'Informe o caminho ou os bytes do anexo.');
          added.push(
            importAttachmentBytes(library, file.name, Buffer.from(file.dataBase64, 'base64'), dest || ''),
          );
        }
        return added;
      }),
  ),
  define(
    'attachment.read',
    'Lê um anexo de imagem como data URL para exibir na interface.',
    z.object({ libraryPath, path: relativePath }),
    ({ libraryPath: folder, path }) => readAttachmentDataUrl(openLibrary(folder), path),
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
    'note.child.create',
    'Cria uma nota filha em PastaDaMae/Filha.md e registra a mãe.',
    z.object({
      libraryPath,
      parent: relativePath,
      title: z.string().min(1),
      origin,
    }),
    ({ libraryPath: folder, parent, title, origin: source }) =>
      tracked(folder, source, 'note.child.create', `Filha de ${parent}`, (library) =>
        createChildNote(library, parent, title),
      ),
  ),
  define(
    'note.children',
    'Lista as notas filhas registradas de uma mãe.',
    z.object({ libraryPath, path: relativePath }),
    ({ libraryPath: folder, path }) => {
      const library = openLibrary(folder);
      return { mother: isMother(library, path), children: listChildren(library, path) };
    },
  ),
  define(
    'entry.trash',
    'Move um arquivo ou pasta para .sophy/lixeira, dentro da biblioteca. Não apaga de forma permanente.',
    z.object({ libraryPath, path: relativePath, origin }),
    ({ libraryPath: folder, path, origin: source }) =>
      tracked(folder, source, 'entry.trash', `Lixeira ${path}`, (library) => trashEntry(library, path)),
  ),
  define(
    'trash.list',
    'Lista a lixeira da biblioteca, da exclusão mais recente para a mais antiga.',
    z.object({ libraryPath }),
    ({ libraryPath: folder }) => listTrash(openLibrary(folder)),
  ),
  define(
    'trash.restore',
    'Devolve um item da lixeira ao caminho original. Se o caminho estiver ocupado, usa o sufixo “ (restaurado)”.',
    z.object({
      libraryPath,
      id: z.string().regex(TRASH_ID, 'Identificador de lixeira inválido.'),
      origin,
    }),
    ({ libraryPath: folder, id }) => restoreTrash(openLibrary(folder), id),
  ),
  define(
    'trash.purge',
    'Apaga de vez um item da lixeira. O original não volta.',
    z.object({
      libraryPath,
      id: z.string().regex(TRASH_ID, 'Identificador de lixeira inválido.'),
      origin,
    }),
    ({ libraryPath: folder, id }) => purgeTrash(openLibrary(folder), id),
  ),
  define(
    'trash.empty',
    'Esvazia a lixeira da biblioteca. Não mexe na lixeira do sistema nem no resto de .sophy.',
    z.object({ libraryPath, origin }),
    ({ libraryPath: folder }) => emptyTrash(openLibrary(folder)),
  ),
  define(
    'note.deletePermanent',
    'Apaga de vez um arquivo ou pasta, sem passar pela lixeira. Vale para nota, canvas, anexo ou pasta.',
    z.object({ libraryPath, path: relativePath, origin }),
    ({ libraryPath: folder, path, origin: source }) =>
      tracked(folder, source, 'note.deletePermanent', `Apagar ${path}`, (library) =>
        deletePermanent(library, path),
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
    'Lista as notas que apontam para esta, com o trecho onde o link aparece.',
    z.object({ libraryPath, path: relativePath }),
    ({ libraryPath: folder, path }) => backlinks(openLibrary(folder), path),
  ),
  define(
    'links.catalog',
    'Catálogo de notas para o menu [[: título, apelidos, seções e blocos.',
    z.object({ libraryPath }),
    ({ libraryPath: folder }) => catalogNotes(openLibrary(folder)),
  ),
  define(
    'links.suggest',
    'Sugere notas para o autocompletar [[ com busca aproximada e apelidos.',
    z.object({
      libraryPath,
      query: z.string(),
      source: relativePath.optional(),
      limit: z.number().int().min(1).max(40).optional(),
    }),
    ({ libraryPath: folder, query, source, limit }) =>
      suggestNotes(openLibrary(folder), query, { source, limit }),
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
    'Grafo em dados: nós e arestas. A UI desenha. Filtra por estante, tag e intervalo de createdAt.',
    z.object({
      libraryPath,
      workspace: z.string().min(1).optional(),
      tag: z.string().min(1).optional(),
      from: z.string().min(1).optional(),
      to: z.string().min(1).optional(),
    }),
    ({ libraryPath: folder, workspace, tag, from, to }) =>
      queryGraph(openLibrary(folder), { workspace, tag, from, to }),
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
    'agent.undo',
    'Desfaz uma ação específica da Sofi pelo versionId do histórico. Falha se a versão não existe ou já foi desfeita.',
    z.object({ libraryPath, versionId: z.string().min(1) }),
    ({ libraryPath: folder, versionId }) => undoById(openLibrary(folder), versionId),
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
    'mention.unlinked',
    'Lista títulos de notas que aparecem em texto puro, fora de wikilink, cerca e código.',
    z.object({ libraryPath }),
    ({ libraryPath: folder }) => unlinkedMentions(openLibrary(folder)),
  ),
  define(
    'mention.link',
    'Troca as menções sem link de um título por [[título]]. Acima de dez, a interface pede confirmação antes de chamar.',
    z.object({ libraryPath, title: z.string().min(3), origin }),
    ({ libraryPath: folder, title, origin: source }) =>
      tracked(folder, source, 'mention.link', `Ligar ${title}`, (library) => linkMentions(library, title)),
  ),
  define(
    'vault.import',
    'Copia Markdown e canvas de uma pasta Obsidian para uma estante. Não escreve na origem e ignora pastas ocultas.',
    z.object({ libraryPath, sourcePath: z.string().min(1), shelf: z.string().min(1), origin }),
    ({ libraryPath: folder, sourcePath, shelf, origin: source }) =>
      tracked(folder, source, 'vault.import', `Importar ${shelf}`, (library) =>
        importVault(library, sourcePath, shelf),
      ),
  ),
  define(
    'view.list',
    'Lista as visões salvas em arquivos .view.',
    z.object({ libraryPath }),
    ({ libraryPath: folder }) => listViews(openLibrary(folder)),
  ),
  define(
    'view.save',
    'Grava uma visão lista, quadro ou tabela num arquivo .view.',
    z.object({
      libraryPath,
      path: relativePath,
      nome: z.string().min(1),
      modo: z.enum(['lista', 'quadro', 'tabela']),
      estante: z.string().optional(),
      tag: z.string().optional(),
      origin,
    }),
    ({ libraryPath: folder, path, nome, modo, estante, tag, origin: source }) =>
      tracked(folder, source, 'view.save', `Visão ${nome}`, (library) =>
        saveView(library, path, { nome, modo, estante, tag }),
      ),
  ),
  define(
    'card.list',
    'Lista os cartões pergunta :: resposta das notas, fora de cercas de código.',
    z.object({ libraryPath, today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), workspace: z.string().min(1).optional() }),
    ({ libraryPath: folder, today, workspace }) => listCards(openLibrary(folder), today, workspace),
  ),
  define(
    'card.review',
    'Registra a nota 1 a 4 de um cartão e grava o próximo prazo em .sophy/flashcards.json. knew continua aceito.',
    z.object({
      libraryPath,
      id: z.string().min(1),
      grade: z.number().optional(),
      knew: z.boolean().optional(),
      today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      origin,
    }),
    ({ libraryPath: folder, id, grade, knew, today, origin: source }) =>
      tracked(folder, source, 'card.review', `Cartão ${id}`, (library) =>
        reviewCard(library, id, grade !== undefined ? grade : knew, today),
      ),
  ),
  define(
    'card.undo',
    'Restaura o agendamento anterior de um cartão. Só guarda um nível.',
    z.object({ libraryPath, id: z.string().min(1), origin }),
    ({ libraryPath: folder, id, origin: source }) =>
      tracked(folder, source, 'card.undo', `Desfazer cartão ${id}`, (library) => undoCard(library, id)),
  ),
  define(
    'version.list',
    'Lista os pontos em .sophy/versoes.',
    z.object({ libraryPath, path: z.string().optional() }),
    ({ libraryPath: folder, path }) => listVersions(openLibrary(folder), path),
  ),
  define(
    'version.point',
    'Grava um ponto da biblioteca antes de uma ação. Apaga o mais antigo acima de 90 dias ou 1 GB.',
    z.object({ libraryPath, label: z.string().min(1), origin }),
    ({ libraryPath: folder, label, origin: source }) =>
      tracked(folder, source, 'version.point', label, (library) => saveVersionPoint(library, label)),
  ),
  define(
    'version.restore',
    'Copia de volta os Markdown e canvas de um ponto em .sophy/versoes.',
    z.object({ libraryPath, id: z.string().min(1), origin }),
    ({ libraryPath: folder, id, origin: source }) =>
      tracked(folder, source, 'version.restore', `Restaurar ${id}`, (library) => restoreVersion(library, id)),
  ),
  define(
    'site.export',
    'Gera um site estático fora da biblioteca, no tema escolhido. Não altera as notas.',
    z.object({ libraryPath, destination: z.string().min(1), theme: z.enum(['light', 'dark']), origin }),
    ({ libraryPath: folder, destination, theme, origin: source }) =>
      tracked(folder, source, 'site.export', 'Exportar site', (library) => exportSite(library, destination, theme)),
  ),
  define(
    'search.semantic',
    'Busca no índice local. Desligada, não cria arquivo nem envia texto.',
    z.object({ libraryPath, query: z.string().min(1) }),
    ({ libraryPath: folder, query }) => semanticSearch(openLibrary(folder), query),
  ),
  define(
    'search.semantic.enable',
    'Monta o índice local de busca. Não baixa modelo e não envia notas.',
    z.object({ libraryPath, origin }),
    ({ libraryPath: folder, origin: source }) =>
      tracked(folder, source, 'search.semantic.enable', 'Ligar busca local', (library) => enableSemantic(library)),
  ),
  define(
    'review.weekly',
    'Diz se hoje é domingo, quando o aviso da revisão aparece. A semana começa na segunda, salvo escolha.',
    z.object({ libraryPath, today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional() }),
    ({ today, weekStartsOn }) => weeklyReview(new Date(`${today}T12:00:00`), weekStartsOn ?? 1),
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
    'Muda status, prazo, agendamento ou prioridade de uma tarefa na linha do Markdown.',
    z.object({
      libraryPath,
      path: relativePath,
      line: z.number().int().positive(),
      status: z.enum(['aberta', 'andamento', 'feita', 'cancelada']).optional(),
      due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      scheduled: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      priority: z.enum(['alta', 'media', 'baixa']).nullable().optional(),
      titleHint: z.string().optional(),
      expectedRevision: z.string().length(64),
      origin,
    }),
    ({
      libraryPath: folder,
      path,
      line,
      status,
      due,
      scheduled,
      priority,
      titleHint,
      expectedRevision,
      origin: source,
    }) =>
      tracked(folder, source, 'task.update', `Tarefa ${path}:${line}`, (library) =>
        updateTask(
          library,
          path,
          line,
          {
            status: status as TaskStatus | undefined,
            due,
            scheduled,
            priority: priority as 'alta' | 'media' | 'baixa' | null | undefined,
          },
          expectedRevision,
          { titleHint },
        ),
      ),
  ),
  define(
    'calendar.query',
    'Lista itens do calendário entre dois dias, sem repetir nota e dia, e resume cada dia.',
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
  define(
    'ui.window',
    'Mostra, oculta, minimiza ou maximiza a janela do Sophy em segundo plano. Ocultar resolve edições pendentes.',
    z.object({ action: z.enum(['show', 'hide', 'minimize', 'maximize']) }),
    ({ action }) => requestUi({ type: 'window', action }),
  ),
  define(
    'ui.setLayout',
    'Controla a seção, lateral, conexões, Sofi e foco da interface. Funciona com a janela oculta.',
    z.object({ libraryPath, section: z.enum(['inicio', 'tarefas', 'calendario', 'grafo', 'canvas', 'config', 'cartas', 'versoes', 'visoes', 'mencoes']).optional(),
      sidebar: z.boolean().optional(), connections: z.boolean().optional(), agent: z.boolean().optional(), focus: z.boolean().optional() }),
    ({ libraryPath: folder, ...layout }) => {
      openLibrary(folder);
      return requestUi({ type: 'setLayout', libraryPath: folder, ...layout });
    },
  ),
] as const;

export function listTools() {
  return tools.map((tool) => ({ name: tool.name, description: tool.description }));
}

const MUTATIONS = new Set([
  'library.watch',
  'workspace.create',
  'directory.create',
  'note.create',
  'note.child.create',
  'note.write',
  'entry.move',
  'entry.trash',
  'note.deletePermanent',
  'trash.restore',
  'trash.purge',
  'trash.empty',
  'history.undo',
  'agent.undo',
  'shelf.style.set',
  'mention.link',
  'vault.import',
  'view.save',
  'card.review',
  'card.undo',
  'version.point',
  'version.restore',
  'site.export',
  'search.semantic.enable',
  'task.update',
  'canvas.create',
  'canvas.update',
  'canvas.node.put',
  'canvas.node.remove',
  'canvas.edge.put',
  'canvas.edge.remove',
  'attachment.import',
]);

export function toolMutates(name: string) {
  return MUTATIONS.has(name);
}

export function callTool(name: string, raw: unknown) {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new EngineError('not-found', `Tool desconhecida: ${name}.`);
  return tool.run(tool.input.parse(raw) as never);
}

const trackedVersions = new WeakMap<object, string>();

/** Id do histórico que `tracked()` gravou para este resultado, quando a mutação mudou o disco. */
export function trackedVersionId(result: unknown) {
  if (!result || typeof result !== 'object') return undefined;
  return trackedVersions.get(result);
}

function tracked<T>(
  folder: string,
  source: Origin,
  tool: string,
  summary: string,
  run: (library: Library) => T,
) {
  const library = openLibrary(folder);
  if (source === 'mcp' || source === 'agent') saveVersionPoint(library, `${source}:${tool}`);
  const before = capture(library);
  const result = run(library);
  const entry = pushHistory(library, {
    origin: source,
    tool,
    summary,
    changes: diff(before, capture(library)),
  });
  if (entry?.id && result !== null && typeof result === 'object') trackedVersions.set(result, entry.id);
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
