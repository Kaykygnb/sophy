const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'notas',
  Object.freeze({
    createLinkedNote: (id, p) => ipcRenderer.invoke('files:create-linked', id, p),
    importAttachments: (id) => ipcRenderer.invoke('files:attachments-import', id),
    linkIndex: (id) => ipcRenderer.invoke('files:links', id),
    searchNotes: (id, query) => ipcRenderer.invoke('files:search', id, query),
    noteGraph: (id) => ipcRenderer.invoke('files:graph', id),
    tree: (id) => ipcRenderer.invoke('files:tree', id),
    readNote: (id, p) => ipcRenderer.invoke('files:read', id, p),
    writeNote: (id, p, text, revision) => ipcRenderer.invoke('files:write', id, p, text, revision),
    readCanvas: (id, p) => ipcRenderer.invoke('files:canvas-read', id, p),
    writeCanvas: (id, p, data, revision) =>
      ipcRenderer.invoke('files:canvas-write', id, p, data, revision),
    createFile: (id, parent, name, kind, content) =>
      ipcRenderer.invoke('files:create', id, parent, name, kind, content),
    moveFile: (id, from, to) => ipcRenderer.invoke('files:move', id, from, to),
    trashFile: (id, p) => ipcRenderer.invoke('files:trash', id, p),
    image: (id, p) => ipcRenderer.invoke('files:image', id, p),
    openExternalFile: (id, p) => ipcRenderer.invoke('files:external', id, p),
    createWorld: (name) => ipcRenderer.invoke('worlds:create', name),
    loadWorld: () => ipcRenderer.invoke('worlds:load'),
    openWorld: (id) => ipcRenderer.invoke('worlds:open', id),
    backupWorld: () => ipcRenderer.invoke('worlds:backup'),
    list: () => ipcRenderer.invoke('areas:list'),
    create: (name) => ipcRenderer.invoke('areas:create', name),
    add: () => ipcRenderer.invoke('areas:add'),
    open: (id) => ipcRenderer.invoke('areas:open', id),
    rename: (id, name) => ipcRenderer.invoke('areas:rename', id, name),
    delete: (id, typedName) => ipcRenderer.invoke('areas:delete', id, typedName),
    locate: (id) => ipcRenderer.invoke('areas:locate', id),
    forget: (id) => ipcRenderer.invoke('areas:forget', id),
    spellcheckInfo: () => ipcRenderer.invoke('spellcheck:info'),
    configureSpellcheck: (enabled, languages) =>
      ipcRenderer.invoke('spellcheck:configure', enabled, languages),
  }),
);
