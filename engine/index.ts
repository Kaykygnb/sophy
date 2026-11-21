/**
 * Motor headless do Sophy.
 *
 * Na interface, `library` aparece como Biblioteca e `workspace` como Estante.
 */
export { EngineError } from './errors.ts';
export { resolveInside } from './paths.ts';
export { MAX_NOTE_BYTES, MAX_TREE_DEPTH, MAX_TREE_ENTRIES } from './limits.ts';
export { splitMarkdown, composeMarkdown, prefixFromFrontmatter } from './markdown.ts';
export {
  openLibrary,
  listWorkspaces,
  createWorkspace,
  createDirectory,
  listNotes,
  listFiles,
  classifyName,
  isImageName,
  importAttachmentFromPath,
  importAttachmentBytes,
  readAttachmentDataUrl,
  readNote,
  createNote,
  writeNote,
  moveEntry,
} from './library.ts';
export {
  trashEntry,
  listTrash,
  restoreTrash,
  purgeTrash,
  emptyTrash,
  deletePermanent,
} from './lixeira.ts';
export { scan, resolvePath, parseTarget } from './wikilinks.ts';
export {
  outgoingLinks,
  backlinks,
  brokenLinks,
  catalogNotes,
  suggestNotes,
  relocate,
  watchLibrary,
} from './links.ts';
export { fold, fuzzyScore, rankByFuzzy } from './fuzzy.ts';
export { capture, diff, pushHistory } from './history.ts';
export { searchLibrary } from './search.ts';
export { queryGraph } from './graph.ts';
export { parseCanvas, serializeCanvas, readCanvas, createCanvas, updateCanvas } from './canvas.ts';
export { listTasks, updateTask, queryCalendar } from './tasks.ts';
export { fillTemplate, unlinkedMentions, linkMentions, importVault, listViews, saveView } from './extras.ts';
export { listCards, reviewCard, saveVersionPoint, listVersions, weeklyReview, semanticSearch, enableSemantic, exportSite } from './study.ts';
export { runAgentTurn, agentTools } from './agent.ts';
export { listHistory, undoLast } from './history.ts';
export { tools, listTools, callTool } from './tools.ts';
export {
  subscribeUi,
  requestUi,
  uiIsOpen,
  publishUiPresence,
  takeUiRequests,
} from './ui-bridge.ts';
export { createMcpServer, serveMcp } from './mcp.ts';
