const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  dialog,
  ipcMain,
  safeStorage,
  session,
  shell,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createToolGate } = require('./ui/commands');

app.setName('Sophy');
app.setPath('userData', path.join(app.getPath('appData'), 'Sophy'));

const testData = process.argv.find((arg) => arg.startsWith('--test-user-data='));
if (testData) {
  const userData = testData.slice('--test-user-data='.length);
  app.setPath('userData', userData);
  process.env.SOPHY_UI_DIR = path.join(userData, 'presenca');
}
process.env.SOPHY_SETTINGS_DIR = app.getPath('userData');
const presetLibrary = process.argv.find((arg) => arg.startsWith('--biblioteca='));
const presetTheme = process.argv.find((arg) => arg.startsWith('--theme='));

const hasInstanceLock = testData ? true : app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();

let engine;
let sessionPath = null;
let gate;
let releasePresence = () => {};
let mailboxTimer;
let agentAbort = null;
const agentConfirms = new Map();
const windows = new Set();
let tray;
let quitting = false;
let quitJob;
let flushSequence = 0;
const pendingCommands = [];

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
  return engine.rememberLibrary(folder);
}

/**
 * A chave da Sofi fica só no processo principal. `agent.providers`,
 * `agent.config.*`, `agent.models`, `agent.testConnection` e `agent.systemPrompt`
 * são atendidas aqui, via `sophy:tool` (`window.sophy.tool(nome, input)`),
 * e não pelo registro puro do motor.
 * O cofre é o `safeStorage` quando `isEncryptionAvailable()`. Se o cofre não
 * existe, a chave cai no modo `arquivo`: base64 em `agent-secrets.json`,
 * protegida só pela pasta do usuário.
 */
function cofreDoSistema() {
  const disponivel = safeStorage.isEncryptionAvailable();
  return {
    disponivel,
    cifrar(texto) {
      return safeStorage.encryptString(texto).toString('base64');
    },
    decifrar(dados) {
      return safeStorage.decryptString(Buffer.from(dados, 'base64'));
    },
  };
}

function abrirConfigSofi() {
  const config = engine.abrirAgentConfig(app.getPath('userData'), cofreDoSistema());
  const legado = agentKeyFile();
  if (!config.temPerfis() && fs.existsSync(legado) && safeStorage.isEncryptionAvailable()) {
    try {
      const key = safeStorage.decryptString(fs.readFileSync(legado)).trim();
      if (key && config.importarLegado(key)) fs.rmSync(legado, { force: true });
    } catch {
      /* o arquivo antigo permanece até o cofre conseguir ler */
    }
  }
  return config;
}

function perfilAtivo(config) {
  const estado = config.get();
  return estado.perfis.find((item) => item.id === estado.ativo) || null;
}

function emitirBiblioteca(info) {
  for (const window of windows) {
    if (!window.isDestroyed()) window.webContents.send('sophy:library-changed', info);
  }
}

function camposDoPerfil(ativo, extra) {
  return {
    id: ativo.id,
    provider: ativo.provider,
    nome: ativo.nome,
    endpoint: ativo.endpoint,
    model: ativo.model,
    ...(ativo.raciocinio ? { raciocinio: ativo.raciocinio } : {}),
    ...extra,
  };
}

function alvoDoTeste(config, body) {
  const entrada = body && typeof body === 'object' ? body : {};
  if (typeof entrada.id === 'string' && entrada.id) {
    const perfil = config.get().perfis.find((item) => item.id === entrada.id);
    if (!perfil) throw new Error('Perfil não encontrado.');
    return {
      provider: perfil.provider,
      endpoint: perfil.endpoint,
      model: perfil.model,
      apiKey: config.segredo(perfil.id) || '',
      raciocinio: Object.prototype.hasOwnProperty.call(entrada, 'raciocinio')
        ? entrada.raciocinio
        : perfil.raciocinio,
    };
  }
  if (typeof entrada.provider !== 'string' || typeof entrada.model !== 'string')
    throw new Error('Informe o perfil ou o provedor e o modelo.');
  const item = engine.provedor(entrada.provider);
  if (!item) throw new Error('Provedor desconhecido.');
  return {
    provider: entrada.provider,
    endpoint:
      typeof entrada.endpoint === 'string' && entrada.endpoint.trim()
        ? entrada.endpoint.trim()
        : item.endpointPadrao,
    model: entrada.model,
    apiKey: typeof entrada.apiKey === 'string' ? entrada.apiKey : '',
    raciocinio: entrada.raciocinio,
  };
}

async function ferramentaDaSofi(name, body) {
  if (name === 'agent.providers') return engine.agentProviders();
  const config = abrirConfigSofi();
  if (name === 'agent.config.get') return config.get();
  if (name === 'agent.config.set') return config.set(body && typeof body === 'object' ? body : {});
  if (name === 'agent.config.remove') return config.remove(body && body.id);
  if (name === 'agent.config.activate') return config.activate(body && body.id);
  if (name === 'agent.systemPrompt') {
    return {
      texto: engine.sofiSystemPrompt({
        libraryPath: sessionPath || undefined,
        context: body,
        modo: body && body.modo,
      }),
    };
  }
  if (name === 'agent.models') {
    if (!body || typeof body.id !== 'string' || !body.id) throw new Error('Informe o perfil.');
    const perfil = config.get().perfis.find((item) => item.id === body.id);
    if (!perfil) throw new Error('Perfil não encontrado.');
    return engine.listarModelos({
      provider: perfil.provider,
      endpoint: perfil.endpoint,
      apiKey: config.segredo(perfil.id) || '',
      fetchImpl: fetch,
    });
  }
  if (name === 'agent.testConnection') {
    return engine.testarConexao({ ...alvoDoTeste(config, body), fetchImpl: fetch });
  }
  throw new Error('Tool desconhecida.');
}

function agentKeyFile() {
  return path.join(app.getPath('userData'), 'agent-key.bin');
}

function fail(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  throw error;
}

function emitAgent(sender, channel, payload) {
  if (sender && !sender.isDestroyed()) sender.send(channel, payload);
}

function waitForAgentConfirm(sender, request, signal) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (allow) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      agentConfirms.delete(request.confirmId);
      resolve(allow === true);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), 120000);
    agentConfirms.set(request.confirmId, finish);
    if (signal?.aborted) {
      finish(false);
      return;
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    emitAgent(sender, 'sophy:agent-confirm', request);
  });
}

function broadcast(command) {
  if (command.type === 'window') {
    if (command.action === 'show') {
      showWindow();
      return;
    }
    const window = [...windows].find((item) => !item.isDestroyed());
    if (!window) return;
    if (command.action === 'hide') requestClose(window);
    else if (command.action === 'minimize') window.minimize();
    else if (command.action === 'maximize') window.maximize();
    return;
  }
  const window = showWindow();
  if (!window.__sophyReady) {
    pendingCommands.push(command);
    return;
  }
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
  handle('sophy:open-external', async (_event, address) => {
    const url = new URL(address);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol))
      throw new Error('Tipo de link não permitido.');
    await shell.openExternal(url.href);
    return true;
  });
  // Abre um arquivo de Anexos/ no aplicativo do sistema. O caminho fica preso à biblioteca.
  handle('sophy:open-attachment', async (_event, relative) => {
    if (!sessionPath) throw new Error('Nenhuma biblioteca aberta.');
    const library = engine.openLibrary(sessionPath);
    const full = engine.resolveAttachmentPath(library, relative);
    const opened = await shell.openPath(full);
    if (opened) throw new Error(opened);
    return true;
  });
  ipcMain.on('sophy:attention', (event) => {
    if (!trusted(event)) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.show();
      window.focus();
    }
  });
  ipcMain.on('sophy:ui-ready', (event) => {
    if (!trusted(event)) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    window.__sophyReady = true;
    for (const command of pendingCommands.splice(0))
      window.webContents.send('sophy:command', command);
  });
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
    if (
      name === 'agent.providers' ||
      name === 'agent.testConnection' ||
      name === 'agent.models' ||
      name === 'agent.systemPrompt' ||
      name.startsWith('agent.config.')
    ) {
      return ferramentaDaSofi(name, body);
    }
    return gate(name, body);
  });

  handle('sophy:agent-status', () => {
    const ativo = perfilAtivo(abrirConfigSofi());
    if (ativo) return { saved: ativo.temChave };
    return { saved: fs.existsSync(agentKeyFile()) };
  });

  handle('sophy:agent-key-set', (_event, key) => {
    if (typeof key !== 'string' || key.trim().length < 8)
      throw new Error('A chave é curta demais.');
    const config = abrirConfigSofi();
    const ativo = perfilAtivo(config);
    if (!ativo) {
      config.set({
        provider: 'openai',
        nome: 'OpenAI',
        model: 'gpt-4o-mini',
        apiKey: key.trim(),
        ativar: true,
      });
    } else {
      config.set(camposDoPerfil(ativo, { apiKey: key.trim(), ativar: true }));
    }
    return { saved: true };
  });

  handle('sophy:agent-key-clear', () => {
    const config = abrirConfigSofi();
    const ativo = perfilAtivo(config);
    if (ativo) config.set(camposDoPerfil(ativo, { apiKey: '' }));
    fs.rmSync(agentKeyFile(), { force: true });
    return { saved: false };
  });

  handle('sophy:agent-ask', async (event, message, context) => {
    if (typeof message !== 'string' || !message.trim()) throw new Error('Escreva o pedido.');
    if (!sessionPath) throw new Error('Nenhuma biblioteca aberta.');
    const config = abrirConfigSofi();
    const ativo = perfilAtivo(config);
    let key = '';
    let provider = 'openai';
    let endpoint;
    let model;
    let requiresKey = true;
    let raciocinio;
    if (ativo) {
      const item = engine.provedor(ativo.provider);
      provider = ativo.provider;
      endpoint = ativo.endpoint;
      model = ativo.model;
      requiresKey = item ? item.precisaChave : true;
      raciocinio = ativo.raciocinio;
      key = config.segredo(ativo.id) || '';
      if (requiresKey && !key) fail('Guarde a chave no cofre antes de pedir.', 'sem_chave');
    } else if (fs.existsSync(agentKeyFile()) && !safeStorage.isEncryptionAvailable()) {
      throw new Error('O cofre do sistema não está disponível.');
    } else {
      fail('Guarde a chave no cofre antes de pedir.', 'sem_chave');
    }
    if (agentAbort)
      throw new Error(
        'A Sofi ainda está respondendo. Cancele o pedido atual antes de enviar outro.',
      );
    const controller = new AbortController();
    agentAbort = controller;
    const modo = context && context.modo === 'pergunta' ? 'pergunta' : 'agente';
    try {
      const turn = await engine.runAgentTurn({
        libraryPath: sessionPath,
        message: message.trim(),
        context,
        modo,
        key,
        provider,
        endpoint,
        model,
        requiresKey,
        raciocinio,
        fetchImpl: fetch,
        signal: controller.signal,
        onProgress: (payload) => emitAgent(event.sender, 'sophy:agent-progress', payload),
        confirm: (request) => waitForAgentConfirm(event.sender, request, controller.signal),
        onLibraryChanged: (info) => {
          sessionPath = info.path;
          try {
            gate('library.watch', { enabled: true });
          } catch {
            /* a troca já foi gravada */
          }
          emitirBiblioteca(info);
        },
      });
      const result = { text: turn.text, actions: turn.actions };
      if (turn.canceled) result.canceled = true;
      if (turn.sugestoes) result.sugestoes = turn.sugestoes;
      if (turn.linksInexistentes) result.linksInexistentes = turn.linksInexistentes;
      if (turn.raciocinio) result.raciocinio = turn.raciocinio;
      return result;
    } finally {
      if (agentAbort === controller) agentAbort = null;
    }
  });

  handle('sophy:agent-cancel', () => {
    if (!agentAbort) return { canceled: false };
    agentAbort.abort();
    return { canceled: true };
  });

  handle('sophy:agent-confirm-reply', (_event, confirmId, allow) => {
    if (typeof confirmId !== 'string' || !agentConfirms.has(confirmId))
      throw new Error('Essa confirmação não está mais pendente.');
    const finish = agentConfirms.get(confirmId);
    finish(allow === true);
    return { allow: allow === true };
  });

  handle('sophy:agent-undo', (_event, versionId) => {
    if (!sessionPath) throw new Error('Nenhuma biblioteca aberta.');
    if (typeof versionId !== 'string' || !versionId.trim())
      throw new Error('Informe a versão para desfazer.');
    return gate('agent.undo', { versionId: versionId.trim() });
  });

  handle('sophy:choose-files', async (event) => {
    if (!trusted(event)) throw new Error('Origem não confiável.');
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(owner || undefined, {
      title: 'Inserir imagem',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] },
        { name: 'Todos', extensions: ['*'] },
      ],
    });
    if (result.canceled) return [];
    return result.filePaths || [];
  });

  handle('sophy:choose-folder', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(owner, {
      title: 'Escolher a pasta da biblioteca',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  handle('sophy:create-library', (_event, folder) => {
    if (typeof folder !== 'string' || !folder.trim())
      throw new Error('Escolha o local da biblioteca.');
    const target = path.resolve(folder);
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(path.basename(target)))
      throw new Error('Esse nome é reservado pelo Windows.');
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(path.join(target, '.sophy'), { recursive: true });
    // Criar a pasta não troca a sessão antes de o editor autorizar a saída.
    return engine.openLibrary(target);
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
    const source = Array.isArray(settings.recentLibraries)
      ? settings.recentLibraries
      : settings.libraries;
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
    for (const key of [
      'onboarded',
      'libraryPath',
      'theme',
      'readingFont',
      'reduceMotion',
      'libraries',
      'accent',
      'accentSystem',
      'semantic',
      'weekStartsOn',
      'collapsedSections',
    ]) {
      if (key === 'collapsedSections' && 'collapsedSections' in patch) {
        const value = patch.collapsedSections;
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('Seções recolhidas inválidas.');
        allowed.collapsedSections = value;
        continue;
      }
      if (key in patch) allowed[key] = patch[key];
    }
    if ('weekStartsOn' in allowed && ![0, 1].includes(allowed.weekStartsOn))
      throw new Error('A semana começa no domingo ou na segunda.');
    if ('accentSystem' in allowed && typeof allowed.accentSystem !== 'boolean')
      throw new Error('A cor do sistema é ligada ou desligada.');
    if ('semantic' in allowed && typeof allowed.semantic !== 'boolean')
      throw new Error('A busca por significado é ligada ou desligada.');
    if (
      'accent' in allowed &&
      !['indigo', 'azul', 'verde-agua', 'musgo', 'ambar', 'vinho', 'grafite'].includes(
        allowed.accent,
      )
    )
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

  // Grava o Markdown devolvido por note.export. O retorno é o objeto em si, sem o envelope { value }.
  ipcMain.handle('sophy:export-markdown', async (event, result) => {
    const failed = (error) => ({
      ok: false,
      path: null,
      written: [],
      error: error instanceof Error ? error.message : error || 'Falha na operação.',
    });
    if (!trusted(event)) return failed('Origem inválida.');
    const written = [];
    try {
      if (!result || typeof result !== 'object' || typeof result.content !== 'string')
        return failed('Exportação Markdown inválida.');
      const files = result.files === undefined ? [] : result.files;
      if (!Array.isArray(files)) return failed('Exportação Markdown inválida.');
      const payloads = new Map();
      for (const file of files) {
        if (!file || typeof file !== 'object' || !engine.exportFileRelative(file.path))
          return failed('O anexo precisa ficar na pasta escolhida.');
        if (payloads.has(file.path)) return failed('Anexo repetido na exportação.');
        payloads.set(file.path, engine.decodeExportBytes(file.bytesBase64));
      }
      const owner = BrowserWindow.fromWebContents(event.sender);
      const suggested = engine.suggestMarkdownName(result.suggestedName || result.filename);
      const chosen = await dialog.showSaveDialog(owner || undefined, {
        title: 'Exportar Markdown',
        defaultPath: suggested,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (chosen.canceled || !chosen.filePath)
        return { ok: false, canceled: true, path: null, written: [] };
      const planInput = {
        directory: path.dirname(chosen.filePath),
        noteFile: chosen.filePath,
        files: files.map((file) => file.path),
        exists: (target) => fs.existsSync(target),
      };
      let plan = engine.planMarkdownExport(planInput);
      if (!plan.ok) return failed(plan.error);
      if (plan.action === 'choose') {
        const answer = await dialog.showMessageBox(owner || undefined, {
          type: 'question',
          buttons: ['Substituir', 'Manter os dois', 'Cancelar'],
          defaultId: 2,
          cancelId: 2,
          message: 'Já existe um arquivo neste destino.',
          detail: plan.conflicts.join('\n'),
        });
        const choice =
          answer.response === 0 ? 'replace' : answer.response === 1 ? 'keep-both' : 'cancel';
        plan = engine.planMarkdownExport({ ...planInput, choice });
        if (!plan.ok) return failed(plan.error);
      }
      if (plan.action !== 'write')
        return { ok: false, canceled: true, path: null, written: [] };
      for (const item of plan.writes) {
        fs.mkdirSync(path.dirname(item.absolute), { recursive: true });
        if (item.source === 'note') {
          fs.writeFileSync(item.absolute, result.content, {
            encoding: 'utf8',
            flag: item.replace ? 'w' : 'wx',
          });
        } else {
          const bytes = payloads.get(item.source);
          if (!bytes) throw new Error('Anexo da exportação inválido.');
          fs.writeFileSync(item.absolute, bytes, { flag: item.replace ? 'w' : 'wx' });
        }
        written.push(item.absolute);
      }
      return { ok: true, path: plan.path, written };
    } catch (error) {
      return { ...failed(error), written };
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
    else if (action === 'quit') requestQuit();
    else throw new Error('Ação de janela desconhecida.');
    return true;
  });
}

function flushWindow(window) {
  if (window.isDestroyed() || !window.__sophyReady) return Promise.resolve(true);
  if (window.__sophyFlush) return window.__sophyFlush;
  const requestId = ++flushSequence;
  window.__sophyFlush = new Promise((resolve) => {
    const done = (saved) => {
      ipcMain.removeListener('sophy:flushed', receive);
      window.removeListener('closed', closed);
      window.__sophyFlush = null;
      resolve(saved);
    };
    const receive = (event, saved, id) => {
      if (event.sender === window.webContents && id === requestId) done(saved === true);
    };
    const closed = () => done(false);
    ipcMain.on('sophy:flushed', receive);
    window.once('closed', closed);
    window.webContents.send('sophy:flush-request', requestId);
  });
  return window.__sophyFlush;
}

async function requestClose(window) {
  if (!(await flushWindow(window)) || window.isDestroyed()) return false;
  // Sem bandeja no ambiente Linux, manter a janela acessível pela barra de tarefas.
  if (tray) window.hide();
  else window.minimize();
  return true;
}

function showWindow() {
  const window = [...windows].find((item) => !item.isDestroyed()) || createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window;
}

async function requestQuit() {
  if (quitJob) return quitJob;
  quitJob = (async () => {
    for (const window of windows) {
      if (!(await flushWindow(window))) {
        showWindow();
        return false;
      }
    }
    quitting = true;
    app.quit();
    return true;
  })();
  try {
    return await quitJob;
  } finally {
    quitJob = null;
  }
}

function createTray() {
  try {
    const image = nativeImage
      .createFromPath(path.join(__dirname, 'ui/assets/app/sophy.png'))
      .resize({ width: 20, height: 20 });
    tray = new Tray(image);
    tray.setToolTip('Sophy');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir Sophy', click: () => showWindow() },
        { type: 'separator' },
        { label: 'Sair do Sophy', click: () => requestQuit() },
      ]),
    );
    tray.on('click', () => showWindow());
  } catch {
    tray = null;
  }
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
      devTools: true,
      backgroundThrottling: !testData,
    },
  });
  windows.add(window);
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (key === 'f12' || ((input.control || input.meta) && input.shift && key === 'i')) {
      event.preventDefault();
      if (window.webContents.isDevToolsOpened()) window.webContents.closeDevTools();
      else window.webContents.openDevTools({ mode: 'detach' });
    }
  });
  window.on('close', (event) => {
    if (quitting) return;
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
  showWindow();
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
  createTray();
  if (!process.argv.includes('--background') || !tray) createWindow();
  app.on('activate', () => {
    showWindow();
  });
});

app.on('window-all-closed', () => {
  // O motor e a presença MCP continuam ativos sem janelas.
});

app.on('before-quit', (event) => {
  if (!quitting) {
    event.preventDefault();
    requestQuit();
  }
});

app.on('will-quit', () => {
  if (mailboxTimer) clearInterval(mailboxTimer);
  releasePresence();
  tray?.destroy();
});
