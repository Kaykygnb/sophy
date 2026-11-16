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
export { tools, listTools, callTool } from './tools.ts';
