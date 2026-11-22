const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'sophy',
  Object.freeze({
    testing: process.argv.some((arg) => arg.startsWith('--test-user-data=')),
    boot: () => ipcRenderer.invoke('sophy:boot'),
    tool: (name, input) => ipcRenderer.invoke('sophy:tool', name, input),
    openExternal: (url) => ipcRenderer.invoke('sophy:open-external', url),
    chooseFolder: () => ipcRenderer.invoke('sophy:choose-folder'),
    chooseFiles: () => ipcRenderer.invoke('sophy:choose-files'),
    createLibrary: (folder) => ipcRenderer.invoke('sophy:create-library', folder),
    switchLibrary: (folder) => ipcRenderer.invoke('sophy:switch-library', folder),
    forgetLibrary: (folder) => ipcRenderer.invoke('sophy:forget-library', folder),
    libraryList: () => ipcRenderer.invoke('sophy:library-list'),
    libraryPick: () => ipcRenderer.invoke('sophy:library-pick'),
    libraryReveal: (folder) => ipcRenderer.invoke('sophy:library-reveal', folder),
    saveSettings: (patch) => ipcRenderer.invoke('sophy:settings', patch),
    exportPdf: (html) => ipcRenderer.invoke('sophy:export-pdf', html),
    agentStatus: () => ipcRenderer.invoke('sophy:agent-status'),
    agentKeySet: (key) => ipcRenderer.invoke('sophy:agent-key-set', key),
    agentKeyClear: () => ipcRenderer.invoke('sophy:agent-key-clear'),
    agentAsk: (message) => ipcRenderer.invoke('sophy:agent-ask', message),
    window: (action) => ipcRenderer.invoke('sophy:window', action),
    onFlush: (listener) => {
      const wrapped = (_event, requestId) => listener(requestId);
      ipcRenderer.on('sophy:flush-request', wrapped);
      return () => ipcRenderer.removeListener('sophy:flush-request', wrapped);
    },
    flushed: (saved, requestId) => ipcRenderer.send('sophy:flushed', saved === true, requestId),
    ready: () => ipcRenderer.send('sophy:ui-ready'),
    attention: () => ipcRenderer.send('sophy:attention'),
    onCommand: (listener) => {
      const wrapped = (_event, command) => listener(command);
      ipcRenderer.on('sophy:command', wrapped);
      return () => ipcRenderer.removeListener('sophy:command', wrapped);
    },
  }),
);
