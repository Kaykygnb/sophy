const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createToolGate } = require('./ui/commands');
const { chosenFilePaths, isSafeExternalUrl, OPEN_FILE_PROPERTIES } = require('./shell-policy');

app.setName('Sophy');
app.setPath('userData', path.join(app.getPath('appData'), 'Sophy'));

const testData = process.argv.find((arg) => arg.startsWith('--test-user-data='));
if (testData) {
  const userData = testData.slice('--test-user-data='.length);
  app.setPath('userData', userData);
  process.env.SOPHY_UI_DIR = path.join(userData, 'presenca');
}
const presetLibrary = process.argv.find((arg) => arg.startsWith('--biblioteca='));
const presetTheme = process.argv.find((arg) => arg.startsWith('--theme='));

const hasInstanceLock = testData ? true : app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();

let engine;
let sessionPath = null;
let gate;
let releasePresence = () => {};
let mailboxTimer;
const windows = new Set();

function settingsFile() {
  return path.join(app.getPath('userData'), 'ui.json');
}

function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

function rememberLibrary(folder) {
  const settings = readSettings();
  const libraries = [
    folder,
    ...(Array.isArray(settings.libraries) ? settings.libraries : []).filter(
      (item) => typeof item === 'string' && item !== folder,
    ),
  ].slice(0, 5);
  return writeSettings({ libraryPath: folder, onboarded: true, libraries, recentLibraries: libraries });
}

function agentKeyFile() {
  return path.join(app.getPath('userData'), 'agent-key.bin');
}

function broadcast(command) {
  for (const window of windows) {
    if (!window.isDestroyed()) window.webContents.send('sophy:command', command);
  }
}

async function loadEngine() {
  engine = await import(pathToFileURL(path.join(__dirname, '..', 'engine', 'index.ts')).href);
  gate = createToolGate({
    call: engine.callTool,
    libraryPath: () => sessionPath,
    setLibraryPath: (value) => {
      sessionPath = value;
    },
  });
  engine.subscribeUi((command) => broadcast(command));
  releasePresence = engine.publishUiPresence();
  mailboxTimer = setInterval(() => {
    for (const command of engine.takeUiRequests()) broadcast(command);
  }, 200);
  if (mailboxTimer.unref) mailboxTimer.unref();
}

function trusted(event) {
  const expected = require('node:url').pathToFileURL(path.join(__dirname, 'index.html')).href;
  return event.senderFrame === event.sender.mainFrame && event.senderFrame.url === expected;
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event)) return { ok: false, error: 'Origem inválida.' };
    try {
      return { ok: true, value: await fn(event, ...args) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Falha na operação.',
        code: error.code,
      };
    }
  });
}

function setupIpc() {
  handle('sophy:boot', () => {
    const settings = readSettings();
    if (presetLibrary) {
      const folder = presetLibrary.slice('--biblioteca='.length);
      const opened = gate('library.open', { path: path.resolve(folder) });
      settings.libraryPath = opened.root;
      settings.onboarded = true;
      rememberLibrary(opened.root);
    } else if (settings.libraryPath) {
      try {
        gate('library.open', { path: settings.libraryPath });
      } catch {
        settings.libraryPath = null;
      }
    }
    if (presetTheme) settings.theme = presetTheme.slice('--theme='.length);
    try {
      gate('library.watch', { enabled: true });
    } catch {
      /* sem biblioteca ainda */
    }
    return {
      settings,
      libraryPath: sessionPath,
      platform: process.platform,
    };
  });

  handle('sophy:tool', async (_event, name, input) => {
    if (typeof name !== 'string' || !/^[a-z]+(\.[A-Za-z]+)+$/.test(name))
      throw new Error('Tool desconhecida.');
    if (/key|chave|secret|token|senha/i.test(name)) throw new Error('Tool desconhecida.');
    const body = input && typeof input === 'object' ? input : {};
    return gate(name, body);
  });

  handle('sophy:agent-status', () => ({
    saved: fs.existsSync(agentKeyFile()),
  }));

  handle('sophy:agent-key-set', (_event, key) => {
    if (typeof key !== 'string' || key.trim().length < 8) throw new Error('A chave é curta demais.');
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('O cofre do sistema não está disponível.');
    fs.writeFileSync(agentKeyFile(), safeStorage.encryptString(key.trim()));
    return { saved: true };
  });

  handle('sophy:agent-key-clear', () => {
    fs.rmSync(agentKeyFile(), { force: true });
    return { saved: false };
  });

  handle('sophy:agent-ask', async (_event, message) => {
    if (typeof message !== 'string' || !message.trim()) throw new Error('Escreva o pedido.');
    if (!sessionPath) throw new Error('Nenhuma biblioteca aberta.');
    if (!fs.existsSync(agentKeyFile())) throw new Error('Guarde a chave no cofre antes de pedir.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('O cofre do sistema não está disponível.');
    const key = safeStorage.decryptString(fs.readFileSync(agentKeyFile()));
    const owner = BrowserWindow.getFocusedWindow() || [...windows][0];
    const turn = await engine.runAgentTurn({
      libraryPath: sessionPath,
      message: message.trim(),
      key,
      fetchImpl: fetch,
      confirm: async (question) => {
        const chosen = await dialog.showMessageBox(owner, {
          type: 'question',
          buttons: ['Cancelar', 'Confirmar'],
          defaultId: 0,
          cancelId: 0,
          message: question,
        });
        return chosen.response === 1;
      },
    });
    return { text: turn.text };
  });

  handle('sophy:choose-folder', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(owner, {
      title: 'Escolher a pasta da biblioteca',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  handle('sophy:choose-files', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(owner, {
      title: 'Escolher arquivos',
      properties: [...OPEN_FILE_PROPERTIES],
    });
    return chosenFilePaths(result);
  });

  handle('sophy:open-external', async (_event, url) => {
    if (!isSafeExternalUrl(url))
      throw new Error('Só é possível abrir links http, https ou mailto.');
    await shell.openExternal(String(url).trim());
    return true;
  });

  handle('sophy:create-library', (_event, folder) => {
    if (typeof folder !== 'string' || !folder.trim())
      throw new Error('Escolha o local da biblioteca.');
    const target = path.resolve(folder);
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(path.basename(target)))
      throw new Error('Esse nome é reservado pelo Windows.');
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(path.join(target, '.sophy'), { recursive: true });
    const opened = gate('library.open', { path: target });
    rememberLibrary(opened.root);
    gate('library.watch', { enabled: true });
    return opened;
  });

  handle('sophy:switch-library', (_event, folder) => {
    if (typeof folder !== 'string' || !folder.trim()) throw new Error('Escolha a biblioteca.');
    const opened = gate('library.open', { path: path.resolve(folder) });
    const settings = rememberLibrary(opened.root);
    gate('library.watch', { enabled: true });
    return { root: opened.root, libraries: settings.libraries };
  });

  handle('sophy:forget-library', (_event, folder) => {
    if (typeof folder !== 'string') throw new Error('Biblioteca inválida.');
    const settings = readSettings();
    const libraries = (Array.isArray(settings.libraries) ? settings.libraries : []).filter(
      (item) => item !== folder,
    );
    const nextPath = settings.libraryPath === folder ? libraries[0] || null : settings.libraryPath;
    writeSettings({ libraries, libraryPath: nextPath });
    if (nextPath) {
      gate('library.open', { path: nextPath });
      gate('library.watch', { enabled: true });
    }
    return { libraryPath: nextPath, libraries };
  });

  handle('sophy:library-list', () => {
    const settings = readSettings();
    const source = Array.isArray(settings.recentLibraries) ? settings.recentLibraries : settings.libraries;
    return (Array.isArray(source) ? source : [])
      .filter((item) => typeof item === 'string')
      .slice(0, 5)
      .map((folder) => ({ name: path.basename(folder), path: folder }));
  });

  handle('sophy:library-pick', async () => {
    const window = BrowserWindow.getFocusedWindow() || windows[0];
    const chosen = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (chosen.canceled || !chosen.filePaths[0]) return null;
    return chosen.filePaths[0];
  });

  handle('sophy:library-reveal', (_event, folder) => {
    if (typeof folder !== 'string' || !folder) throw new Error('Escolha a biblioteca.');
    shell.showItemInFolder(folder);
    return true;
  });

  handle('sophy:settings', (_event, patch) => {
    if (!patch || typeof patch !== 'object') throw new Error('Configuração inválida.');
    const allowed = {};
    for (const key of ['onboarded', 'libraryPath', 'theme', 'readingFont', 'reduceMotion', 'libraries', 'accent', 'accentSystem', 'semantic', 'weekStartsOn']) {
      if (key in patch) allowed[key] = patch[key];
    }
    if ('weekStartsOn' in allowed && ![0, 1].includes(allowed.weekStartsOn))
      throw new Error('A semana começa no domingo ou na segunda.');
    if ('accentSystem' in allowed && typeof allowed.accentSystem !== 'boolean')
      throw new Error('A cor do sistema é ligada ou desligada.');
    if ('semantic' in allowed && typeof allowed.semantic !== 'boolean')
      throw new Error('A busca por significado é ligada ou desligada.');
    if ('accent' in allowed && !['indigo', 'azul', 'verde-agua', 'musgo', 'ambar', 'vinho', 'grafite'].includes(allowed.accent))
      throw new Error('Cor de destaque inválida.');
    if ('theme' in allowed && !['light', 'dark', 'system'].includes(allowed.theme))
      throw new Error('Tema inválido.');
    if ('readingFont' in allowed && !['inter', 'literata'].includes(allowed.readingFont))
      throw new Error('Fonte inválida.');
    if ('libraries' in allowed && !Array.isArray(allowed.libraries))
      throw new Error('Lista de bibliotecas inválida.');
    return writeSettings(allowed);
  });

  handle('sophy:export-pdf', async (_event, html) => {
    if (typeof html !== 'string' || !html.includes('data-theme="light"') || html.length > 2_000_000)
      throw new Error('O PDF sai sempre em papel claro.');
    const paper = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    try {
      await paper.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const data = await paper.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
      const parent = BrowserWindow.getFocusedWindow() || windows[0];
      const chosen = await dialog.showSaveDialog(parent, {
        defaultPath: 'nota.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (chosen.canceled || !chosen.filePath) return null;
      fs.writeFileSync(chosen.filePath, data);
      return chosen.filePath;
    } finally {
      paper.destroy();
    }
  });

  handle('sophy:window', (event, action) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    } else if (action === 'close') requestClose(window);
    else throw new Error('Ação de janela desconhecida.');
    return true;
  });
}

function requestClose(window) {
  if (window.__sophyClosing) return;
  window.__sophyClosing = true;
  const timer = setTimeout(() => window.destroy(), 1500);
  const done = () => {
    clearTimeout(timer);
    if (!window.isDestroyed()) window.destroy();
  };
  ipcMain.once('sophy:flushed', (event) => {
    if (event.sender === window.webContents) done();
  });
  window.webContents.send('sophy:flush-request');
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    title: 'Sophy',
    frame: false,
    icon: path.join(__dirname, 'ui/assets/app/sophy.png'),
    backgroundColor: readSettings().theme === 'dark' ? '#14131A' : '#FAF9F7',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !testData,
    },
  });
  windows.add(window);
  window.on('close', (event) => {
    if (window.__sophyClosing) return;
    event.preventDefault();
    requestClose(window);
  });
  window.on('closed', () => windows.delete(window));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.loadFile(path.join(__dirname, 'index.html'));
  window.once('ready-to-show', () => {
    window.show();
    if (process.argv.includes('--dev')) window.webContents.openDevTools({ mode: 'detach' });
  });
  return window;
}

app.on('second-instance', () => {
  const window = [...windows][0];
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});

app.whenReady().then(async () => {
  if (!hasInstanceLock) return;
  try {
    await loadEngine();
    setupIpc();
  } catch (error) {
    dialog.showErrorBox(
      'Não foi possível abrir o Sophy',
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
    return;
  }
  Menu.setApplicationMenu(null);
  try {
    session.defaultSession.setSpellCheckerLanguages(['pt-BR']);
  } catch {
    /* o dicionário pt-BR pode não estar neste Electron */
  }
  createWindow();
  app.on('activate', () => {
    if (windows.size === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (mailboxTimer) clearInterval(mailboxTimer);
  releasePresence();
});
