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
    libraryReveal: (folder) => ipcRenderer.invoke('sophy:library-reveal', folder),
    saveSettings: (patch) => ipcRenderer.invoke('sophy:settings', patch),
    exportPdf: (html) => ipcRenderer.invoke('sophy:export-pdf', html),
    exportMarkdown: (result) => ipcRenderer.invoke('sophy:export-markdown', result),
    openAttachment: (path) => ipcRenderer.invoke('sophy:open-attachment', path),
    agentStatus: () => ipcRenderer.invoke('sophy:agent-status'),
    agentKeySet: (key) => ipcRenderer.invoke('sophy:agent-key-set', key),
    agentKeyClear: () => ipcRenderer.invoke('sophy:agent-key-clear'),
    agentAsk: (message, context) => ipcRenderer.invoke('sophy:agent-ask', message, context),
    agentCancel: () => ipcRenderer.invoke('sophy:agent-cancel'),
    agentConfirmReply: (confirmId, allow) =>
      ipcRenderer.invoke('sophy:agent-confirm-reply', confirmId, allow),
    onAgentProgress: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on('sophy:agent-progress', wrapped);
      return () => ipcRenderer.removeListener('sophy:agent-progress', wrapped);
    },
    onAgentConfirm: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on('sophy:agent-confirm', wrapped);
      return () => ipcRenderer.removeListener('sophy:agent-confirm', wrapped);
    },
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
