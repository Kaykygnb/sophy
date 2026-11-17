const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'sophy',
  Object.freeze({
    boot: () => ipcRenderer.invoke('sophy:boot'),
    tool: (name, input) => ipcRenderer.invoke('sophy:tool', name, input),
    chooseFolder: () => ipcRenderer.invoke('sophy:choose-folder'),
    createLibrary: (folder) => ipcRenderer.invoke('sophy:create-library', folder),
    switchLibrary: (folder) => ipcRenderer.invoke('sophy:switch-library', folder),
    forgetLibrary: (folder) => ipcRenderer.invoke('sophy:forget-library', folder),
    saveSettings: (patch) => ipcRenderer.invoke('sophy:settings', patch),
    window: (action) => ipcRenderer.invoke('sophy:window', action),
    onCommand: (listener) => {
      const wrapped = (_event, command) => listener(command);
      ipcRenderer.on('sophy:command', wrapped);
      return () => ipcRenderer.removeListener('sophy:command', wrapped);
    },
  }),
);
