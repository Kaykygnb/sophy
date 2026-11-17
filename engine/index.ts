/**
 * Motor headless do Sophy.
 *
 * Na interface, `library` aparece como Biblioteca e `workspace` como Estante.
 */
export { EngineError } from './errors.ts';
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
  readNote,
  createNote,
  writeNote,
  moveEntry,
  trashEntry,
} from './library.ts';
export { scan, resolvePath, parseTarget } from './wikilinks.ts';
export { outgoingLinks, backlinks, brokenLinks, watchLibrary } from './links.ts';
export { searchLibrary } from './search.ts';
export { queryGraph } from './graph.ts';
export { parseCanvas, serializeCanvas, readCanvas, createCanvas, updateCanvas } from './canvas.ts';
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
