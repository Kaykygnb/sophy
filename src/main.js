const { app, BrowserWindow, Menu, MenuItem, ipcMain, dialog, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.setName('Sophy');
// Keep the existing registry/profile when upgrading from Notas1 to Sophy.
app.setPath('userData', path.join(app.getPath('appData'), 'notas1'));

if (!app.isPackaged) {
  const testData = process.argv.find((arg) => arg.startsWith('--test-user-data='));
  if (testData) app.setPath('userData', testData.slice('--test-user-data='.length));
}

const { createWorkspaceCore } = require('./workspace-core');
let store,
  core,
  busy = false;
const spellLanguages = ['pt-BR', 'pt', 'en-US', 'es', 'fr', 'de', 'it'];
const uiCommand = process.argv.find((arg) => arg.startsWith('--sophy-ui='))?.split('=')[1];
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
app.on('second-instance', (_event, argv) => {
  const window = BrowserWindow.getAllWindows()[0];
  const command = argv.find((arg) => arg.startsWith('--sophy-ui='))?.split('=')[1];
  if (command === 'close') {
    window?.close();
    return;
  }
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
});
function setupWorkspaceAPI() {
  core = createWorkspaceCore({
    userData: app.getPath('userData'),
    home: app.getPath('home'),
    appPath: app.getAppPath(),
  });
  const worlds = core.worlds;
  const current = () => worlds.current();
  const owner = (e) => BrowserWindow.fromWebContents(e.sender);
  const confirm = async (e, message, detail, action) =>
    (
      await dialog.showMessageBox(owner(e), {
        type: 'warning',
        message,
        detail,
        buttons: ['Cancelar', action],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
    ).response === 1;
  const choose = async (e, title) => {
    const result = await dialog.showOpenDialog(owner(e), {
      title,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  };
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (e, ...args) => {
      const expected = require('node:url').pathToFileURL(path.join(__dirname, 'index.html')).href;
      if (e.senderFrame !== e.sender.mainFrame || e.senderFrame.url !== expected)
        return { ok: false, error: 'Origem inválida.' };
      if (busy) return { ok: false, error: 'Aguarde a operação atual.' };
      busy = true;
      try {
        return { ok: true, value: await fn(e, ...args) };
      } catch (error) {
        return { ok: false, error: error.message, code: error.code };
      } finally {
        busy = false;
      }
    });
  const files = (id) => core.files(id);
  handle('files:attachments-import', async (e, id) => {
    const result = await dialog.showOpenDialog(owner(e), {
      title: 'Adicionar arquivos à pasta Anexos',
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    return files(id).importAttachments(result.filePaths);
  });
  handle('files:create-linked', (_e, id, relative) => files(id).createLinked(relative));
  handle('files:links', (_e, id) => files(id).linkIndex());
  handle('files:search', (_e, id, query) => files(id).searchNotes(query));
  handle('files:graph', (_e, id) => files(id).noteGraph());
  handle('files:tree', (_e, id) => files(id).tree());
  handle('files:read', (_e, id, relative) => files(id).read(relative));
  handle('files:write', (_e, id, relative, text, revision) =>
    files(id).write(relative, text, revision),
  );
  handle('files:canvas-read', (_e, id, relative) => files(id).readCanvas(relative));
  handle('files:canvas-write', (_e, id, relative, data, revision) =>
    files(id).writeCanvas(relative, data, revision),
  );
  handle('files:create', (_e, id, parent, name, kind, content) =>
    files(id).create(parent, name, kind, content),
  );
  handle('files:move', (_e, id, source, target) => files(id).moveWithLinks(source, target));
  handle('files:image', (_e, id, relative) => files(id).image(relative));
  handle('files:external', async (e, id, relative) => {
    const full = files(id).resolve(relative);
    const executable =
      /\.(exe|com|bat|cmd|ps1|sh|bash|zsh|fish|desktop|appimage|msi|deb|rpm|js|mjs|cjs|py|jar|vbs|lnk|url|html|htm|svg)$/i.test(
        relative,
      );
    if (executable) {
      shell.showItemInFolder(full);
      return true;
    }
    if (
      !(await confirm(
        e,
        'Abrir no aplicativo padrão?',
        `O arquivo será aberto pelo aplicativo associado no sistema.\n\n${full}`,
        'Abrir arquivo',
      ))
    )
      return false;
    const error = await shell.openPath(files(id).resolve(relative));
    if (error) throw Error(error);
    return true;
  });
  handle('files:trash', async (e, id, relative) => {
    const service = files(id),
      snapshot = service.trashSnapshot(relative);
    if (
      !(await confirm(
        e,
        'Mover para a lixeira?',
        `O item e, se for uma pasta, todo o seu conteúdo serão enviados à lixeira do sistema.\n\n${snapshot.full}`,
        'Mover para a lixeira',
      ))
    )
      return false;
    return service.trash(relative, snapshot, (full) => shell.trashItem(full));
  });
  handle('areas:list', () => worlds.state());
  handle('worlds:create', async (e, name) => {
    const parent = await choose(e, 'Escolha onde criar a pasta da biblioteca');
    if (!parent) return null;
    return worlds.create(name, parent);
  });
  handle('worlds:load', async (e) => {
    const folder = await choose(e, 'Carregar biblioteca — escolha a pasta raiz');
    if (!folder) return null;
    const info = worlds.inspect(folder);
    if (
      !info.initialized &&
      !(await confirm(
        e,
        'Usar esta pasta como biblioteca?',
        `O Sophy criará a pasta interna .notas1 para administrar esta biblioteca. As subpastas existentes não serão cadastradas automaticamente. Nenhum arquivo será movido ou apagado.\n\n${info.root}`,
        'Criar biblioteca nesta pasta',
      ))
    )
      return null;
    return info.initialized
      ? worlds.load(info.root)
      : worlds.initialize(path.basename(info.root), info.root);
  });
  handle('worlds:open', (_e, id) => {
    const w = worlds.known.worlds.find((w) => w.id === id);
    if (!w) throw Error('Biblioteca não encontrada.');
    return worlds.load(w.path, id);
  });
  handle('worlds:backup', async (e) => {
    const active = current();
    const root = active.root;
    const name = active.world?.name || 'Sophy';
    if (!root) throw Error('Carregue uma biblioteca primeiro.');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const result = await dialog.showOpenDialog(owner(e), {
      title: 'Escolha onde salvar a cópia de segurança',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const safeName =
      String(name)
        .replace(/[<>:"|?*\\/]/g, '_')
        .trim()
        .slice(0, 80) || 'Sophy';
    const dest = path.join(result.filePaths[0], `${safeName}-backup-${stamp}`);
    if (fs.existsSync(dest)) throw Error('Já existe uma pasta com esse nome no destino.');
    fs.cpSync(root, dest, { recursive: true, dereference: false });
    return { path: dest };
  });
  handle('areas:create', async (e, name) => {
    store = current();
    const result = store.create(name);
    if (result.exists) {
      store.safe(result.path);
      if (
        !(await confirm(
          e,
          'A subpasta já existe. Cadastrar como estante?',
          `O Sophy passará a administrar esta subpasta. Excluir a estante poderá apagar permanentemente todo o conteúdo.\n\n${result.path}`,
          'Cadastrar estante',
        ))
      )
        return null;
      store.register(name, result.path);
    }
    return worlds.state();
  });
  handle('areas:add', async (e) => {
    store = current();
    const folder = await choose(e, 'Cadastrar subpasta da biblioteca atual');
    if (!folder) return null;
    const real = store.safe(folder);
    if (
      !(await confirm(
        e,
        'Cadastrar esta subpasta como estante?',
        `O Sophy passará a administrar seu conteúdo. Excluir a estante poderá apagar permanentemente esta subpasta e todos os arquivos.\n\n${real}`,
        'Cadastrar estante',
      ))
    )
      return null;
    store.register(path.basename(real), real);
    return worlds.state();
  });
  handle('areas:open', (_e, id) => current().open(id));
  handle('areas:rename', (_e, id, name) => {
    current().rename(id, name);
    return worlds.state();
  });
  handle('areas:locate', async (e, id) => {
    store = current();
    const w = store.get(id),
      folder = await choose(e, 'Localizar subpasta dentro do mundo atual');
    if (!folder) return null;
    const real = store.safe(folder, id);
    if (
      !(await confirm(
        e,
        `Usar esta subpasta para “${w.name}”?`,
        `O identificador e o nome serão preservados. Confirme que esta é a subpasta correta.\n\nAnterior: ${w.path}\n\nNova pasta: ${real}`,
        'Confirmar pasta',
      ))
    )
      return null;
    store.relocate(id, real);
    return worlds.state();
  });
  handle('areas:forget', async (e, id) => {
    store = current();
    const w = store.get(id);
    if (
      !(await confirm(
        e,
        'Remover apenas o cadastro?',
        `Nenhum arquivo será apagado.\n\n${w.path}`,
        'Remover cadastro',
      ))
    )
      return null;
    store.forget(id);
    return worlds.state();
  });
  handle('areas:delete', async (e, id, typedName) => {
    store = current();
    const w = store.get(id);
    if (typedName !== w.name) throw Error('O nome digitado não corresponde ao nome da estante.');
    const snapshot = store.deletionSnapshot(id);
    if (
      !(await confirm(
        e,
        `Apagar permanentemente “${w.name}”?`,
        `Somente a subpasta abaixo e TODOS os seus arquivos serão apagados permanentemente. A biblioteca e as outras estantes serão preservadas. Não é possível desfazer.\n\n${w.path}`,
        'Apagar permanentemente',
      ))
    )
      return null;
    store.delete(id, snapshot);
    return worlds.state();
  });
  handle('spellcheck:info', () => ({
    enabled: session.defaultSession.isSpellCheckerEnabled(),
    languages: session.defaultSession.getSpellCheckerLanguages(),
    available: session.defaultSession.availableSpellCheckerLanguages.filter((language) =>
      spellLanguages.includes(language),
    ),
    platform: process.platform,
  }));
  handle('spellcheck:configure', (_e, enabled, languages) => {
    if (typeof enabled !== 'boolean' || !Array.isArray(languages) || languages.length > 7)
      throw Error('Preferências do corretor inválidas.');
    if (languages.some((language) => !spellLanguages.includes(language)))
      throw Error('Idioma do corretor inválido.');
    const available = session.defaultSession.availableSpellCheckerLanguages;
    if (
      process.platform !== 'darwin' &&
      languages.some((language) => !available.includes(language))
    )
      throw Error('Um dos dicionários escolhidos não está disponível neste Electron.');
    if (languages.length && process.platform !== 'darwin')
      session.defaultSession.setSpellCheckerLanguages(languages);
    session.defaultSession.setSpellCheckerEnabled(enabled);
    return {
      enabled,
      languages: process.platform === 'darwin' ? [] : languages,
    };
  });
}
function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: 'Sophy',
    icon: path.join(__dirname, '../assets/sophy.png'),
    backgroundColor: '#f7f8fa',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !process.argv.some((arg) => arg.startsWith('--test-user-data=')),
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('context-menu', (event, params) => {
    if (!params.isEditable || !params.misspelledWord) return;
    event.preventDefault();
    const menu = new Menu();
    const suggestions = params.dictionarySuggestions || [];
    if (suggestions.length) {
      for (const suggestion of suggestions.slice(0, 6))
        menu.append(
          new MenuItem({
            label: suggestion,
            click: () => window.webContents.replaceMisspelling(suggestion),
          }),
        );
    } else {
      menu.append(new MenuItem({ label: 'Nenhuma sugestão disponível', enabled: false }));
    }
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(
      new MenuItem({
        label: 'Adicionar ao dicionário',
        click: () => session.defaultSession.addWordToSpellCheckerDictionary(params.misspelledWord),
      }),
    );
    const flags = params.editFlags || {};
    const actions = [
      ['canUndo', 'Desfazer', () => window.webContents.undo()],
      ['canRedo', 'Refazer', () => window.webContents.redo()],
      ['canCut', 'Recortar', () => window.webContents.cut()],
      ['canCopy', 'Copiar', () => window.webContents.copy()],
      ['canPaste', 'Colar', () => window.webContents.paste()],
      ['canSelectAll', 'Selecionar tudo', () => window.webContents.selectAll()],
    ].filter(([key]) => flags[key]);
    if (actions.length) {
      menu.append(new MenuItem({ type: 'separator' }));
      for (const [, label, click] of actions) menu.append(new MenuItem({ label, click }));
    }
    menu.popup({ window });
  });
  window.loadFile(path.join(__dirname, 'index.html'));
  window.once('ready-to-show', () => {
    if (!process.argv.some((arg) => arg.startsWith('--test-user-data='))) window.show();
    console.log('Sophy: janela pronta.');
    if (process.argv.includes('--dev')) window.webContents.openDevTools({ mode: 'detach' });
  });
  window.webContents.on('will-prevent-unload', (event) => {
    const response = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: ['Continuar no editor', 'Descartar alterações e sair'],
      defaultId: 0,
      cancelId: 0,
      message: 'Há notas com alterações não salvas.',
      detail: 'Saia somente se quiser descartar essas alterações.',
    });
    if (response === 1) event.preventDefault();
  });
  window.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('Falha ao carregar:', code, description);
  });
}
app.whenReady().then(() => {
  if (!hasInstanceLock) return;
  if (uiCommand === 'close') {
    app.quit();
    return;
  }
  try {
    setupWorkspaceAPI();
    const checker = session.defaultSession;
    checker.setSpellCheckerEnabled(true);
    if (process.platform !== 'darwin') {
      const available = checker.availableSpellCheckerLanguages;
      const initialLanguage = ['pt-BR', 'pt', 'en-US'].find((language) =>
        available.includes(language),
      );
      if (initialLanguage) checker.setSpellCheckerLanguages([initialLanguage]);
    }
  } catch (error) {
    dialog.showErrorBox('Não foi possível carregar as áreas', error.message);
    app.quit();
    return;
  }
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
