const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const commands = require('../src/ui/commands');

test('o menu / abre no começo da linha e de novo depois do Esc', () => {
  assert.equal(commands.slashQuery('olá /lis', 'olá /lis'.length), null);
  assert.equal(commands.slashQuery('palavra/lis', 'palavra/lis'.length), null);
  assert.deepEqual(commands.slashQuery('/titulo', 7), { start: 0, query: 'titulo' });
  assert.deepEqual(commands.slashQuery('  /lis', '  /lis'.length), { start: 2, query: 'lis' });
  const session = commands.createSlashSession();
  const text = '/cod';
  assert.ok(session.offer(text, text.length));
  session.dismiss(text, text.length);
  assert.equal(session.offer(text, text.length), null);
  const again = '/nova';
  assert.ok(session.offer(again, again.length));
});

test('o menu / acha o diagrama Mermaid por mermaid, fluxo e grafico', () => {
  const byMerm = commands.filterSlash(commands.SLASH_ITEMS, 'merm');
  assert.equal(byMerm[0].id, 'mermaid');
  assert.ok(byMerm.some((item) => item.label === 'Diagrama (Mermaid)'));
  assert.ok(byMerm.some((item) => item.id === 'mermaid-sequencia'));
  const byFluxo = commands.filterSlash(commands.SLASH_ITEMS, 'fluxograma');
  assert.ok(byFluxo.some((item) => item.id === 'mermaid'));
  const byGrafico = commands.filterSlash(commands.SLASH_ITEMS, 'grafico');
  assert.ok(byGrafico.some((item) => item.id === 'mermaid'));
  const bySeq = commands.filterSlash(commands.SLASH_ITEMS, 'sequencia');
  assert.ok(bySeq.some((item) => item.id === 'mermaid-sequencia'));
  const byGantt = commands.filterSlash(commands.SLASH_ITEMS, 'cronograma');
  assert.ok(byGantt.some((item) => item.id === 'mermaid-gantt'));
});

test('[[ oferece o termo em qualquer posição depois de espaço', () => {
  const text = 'veja [[Est';
  assert.deepEqual(commands.wikiQuery(text, text.length), { start: 5, query: 'Est' });
  assert.equal(commands.wikiQuery('já [[Nota]] ', 'já [[Nota]] '.length), null);
});

test('a porta IPC ignora origem e biblioteca pedidas pelo renderer', async () => {
  const engine = await import('../engine/tools.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-gate-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-other-'));
  let current = null;
  const gate = commands.createToolGate({
    call: engine.callTool,
    libraryPath: () => current,
    setLibraryPath: (value) => {
      current = value;
    },
  });
  const opened = gate('library.open', { path: root, libraryPath: other });
  assert.equal(opened.root, root);
  assert.equal(current, root);
  const created = gate('note.create', {
    path: 'Nota.md',
    body: 'oi [[',
    origin: 'agent',
    libraryPath: other,
  });
  assert.equal(created.body, 'oi [[');
  assert.equal(fs.existsSync(path.join(other, 'Nota.md')), false);
  const history = gate('history.list', { libraryPath: other });
  assert.equal(history[0].origin, 'ui');
  assert.equal(history[0].tool, 'note.create');
  const again = gate('library.open', {});
  assert.equal(again.root, root);
});

test('a chamada da janela força origem ui e ignora o caminho do input', () => {
  const prepared = commands.prepareCall(
    'note.write',
    {
      path: 'Nota.md',
      body: 'oi [[',
      expectedRevision: 'a'.repeat(64),
      origin: 'mcp',
      libraryPath: '/tmp/outra',
    },
    '/tmp/biblioteca',
  );
  assert.equal(prepared.origin, 'ui');
  assert.equal(prepared.libraryPath, '/tmp/biblioteca');
  assert.equal(prepared.body, 'oi [[');
  for (const name of [
    'trash.purge',
    'trash.empty',
    'note.deletePermanent',
    'card.undo',
    'trash.restore',
    'block.rename',
  ]) {
    const body = commands.prepareCall(name, { id: 'x', path: 'Nota.md' }, '/tmp/biblioteca');
    assert.equal(body.origin, 'ui', name);
    assert.equal(body.libraryPath, '/tmp/biblioteca');
  }
  const theme = commands.prepareCall(
    'ui.setTheme',
    { theme: 'dark', libraryPath: '/x' },
    '/biblioteca',
  );
  assert.equal(theme.libraryPath, undefined);
  assert.equal(theme.theme, 'dark');
});

test('a UI renomeia o bloco com origem ui e agent.undo desfaz todos os arquivos', async () => {
  const engine = await import('../engine/tools.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-rename-'));
  let current = null;
  const gate = commands.createToolGate({
    call: engine.callTool,
    libraryPath: () => current,
    setLibraryPath: (value) => {
      current = value;
    },
  });
  gate('library.open', { path: root });
  gate('note.create', {
    path: 'Estudos/Nota.md',
    body: '# Outro\n\n```js title="api"\nconst a = 1;\n```\n\n[[#api|local]]\n',
    origin: 'agent',
  });
  gate('note.create', { path: 'Estudos/Fonte.md', body: '[[Nota#api|apelido]]\n' });
  const canvasPath = path.join(root, 'Estudos', 'Quadro.canvas');
  fs.writeFileSync(
    canvasPath,
    JSON.stringify({
      nodes: [{ id: '1', type: 'text', text: 'Canvas [[Nota#api]]', x: 0, y: 0, width: 100, height: 40 }],
      edges: [],
    }),
  );
  const notePath = path.join(root, 'Estudos', 'Nota.md');
  const fontePath = path.join(root, 'Estudos', 'Fonte.md');
  const before = {
    note: fs.readFileSync(notePath, 'utf8'),
    fonte: fs.readFileSync(fontePath, 'utf8'),
    canvas: fs.readFileSync(canvasPath, 'utf8'),
  };
  assert.throws(
    () => gate('block.rename', { notePath: 'Estudos/Nota.md', de: 'api', para: 'Outro', origin: 'mcp' }),
    (error) => error.code === 'nome_em_uso' && /seção ou um bloco/.test(error.message),
  );
  assert.equal(fs.readFileSync(notePath, 'utf8'), before.note);
  assert.equal(fs.readFileSync(fontePath, 'utf8'), before.fonte);
  const result = gate('block.rename', {
    notePath: 'Estudos/Nota.md',
    de: 'api',
    para: 'codigo',
    origin: 'mcp',
  });
  assert.equal(result.path, 'Estudos/Nota.md');
  assert.equal(result.title, 'codigo');
  assert.equal(result.from, 'api');
  assert.equal(result.shadowed, false);
  assert.ok(result.updated.includes('Estudos/Nota.md'));
  assert.ok(result.updated.includes('Estudos/Fonte.md'));
  assert.ok(result.updated.includes('Estudos/Quadro.canvas'));
  assert.equal(typeof result.versionId, 'string');
  assert.ok(result.versionId);
  gate('note.create', { path: 'Estudos/Depois.md', body: 'fica\n' });
  const history = gate('history.list', {});
  const rename = history.find((item) => item.tool === 'block.rename');
  assert.equal(rename.id, result.versionId);
  assert.equal(rename.origin, 'ui');
  const undone = gate('agent.undo', { versionId: result.versionId });
  assert.equal(undone.undone, result.versionId);
  assert.equal(undone.tool, 'block.rename');
  assert.equal(fs.readFileSync(notePath, 'utf8'), before.note);
  assert.equal(fs.readFileSync(fontePath, 'utf8'), before.fonte);
  assert.equal(fs.readFileSync(canvasPath, 'utf8'), before.canvas);
  assert.match(fs.readFileSync(path.join(root, 'Estudos', 'Depois.md'), 'utf8'), /fica/);
});

test('conflito de revisão não é tratado como gravação', async () => {
  const calls = [];
  const client = commands.createClient((name, input) => {
    calls.push({ name, input });
    return { conflict: true, current: { body: 'disco', revision: 'b'.repeat(64) } };
  }, '/tmp/biblioteca');
  const saved = await commands.saveNote(client, {
    path: 'Nota.md',
    body: 'tela',
    revision: 'a'.repeat(64),
  });
  assert.equal(saved.saved, false);
  assert.match(saved.message, /Nada foi gravado/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.origin, 'ui');
  assert.equal(calls[0].input.libraryPath, '/tmp/biblioteca');
  assert.equal(calls[0].input.body, 'tela');
});

test('cada comando ui.* muda a janela', () => {
  let state = { view: 'library', theme: 'light', path: null };
  state = commands.applyUiCommand(state, {
    type: 'openNote',
    libraryPath: '/bib',
    path: 'Estudos/Nota.md',
  });
  assert.equal(state.view, 'note');
  assert.equal(state.path, 'Estudos/Nota.md');
  state = commands.applyUiCommand(state, {
    type: 'showGraph',
    libraryPath: '/bib',
    workspace: 'Estudos',
  });
  assert.equal(state.view, 'graph');
  assert.equal(state.workspace, 'Estudos');
  state = commands.applyUiCommand(state, { type: 'setTheme', theme: 'dark' });
  assert.equal(state.theme, 'dark');
  state = commands.applyUiCommand(state, {
    type: 'openCanvas',
    libraryPath: '/bib',
    path: 'Mapa.canvas',
  });
  assert.equal(state.view, 'canvas');
  assert.equal(state.placeholder, true);
  assert.equal(state.path, 'Mapa.canvas');
});

test('Entrada não tem cor e as outras estantes usam um marcador de 1 a 8', () => {
  assert.deepEqual(commands.shelfMark('Entrada'), { icon: 'caixa-entrada', color: null });
  const mark = commands.shelfMark('Estudos');
  assert.equal(mark.color >= 1 && mark.color <= 8, true);
  assert.equal(typeof mark.icon, 'string');
});

test('as tools ui.* chegam na janela pelo mesmo registro', async () => {
  const engine = await import('../engine/tools.ts');
  const bridge = await import('../engine/ui-bridge.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-bridge-'));
  fs.writeFileSync(path.join(root, 'Nota.md'), 'olá\n');
  const seen = [];
  const stop = bridge.subscribeUi((command) => seen.push(command));
  try {
    let state = { view: 'library', theme: 'light' };
    engine.callTool('ui.openNote', { libraryPath: root, path: 'Nota.md' });
    state = commands.applyUiCommand(state, seen.at(-1));
    engine.callTool('ui.showGraph', { libraryPath: root, workspace: 'Estudos' });
    state = commands.applyUiCommand(state, seen.at(-1));
    engine.callTool('ui.setTheme', { theme: 'dark' });
    state = commands.applyUiCommand(state, seen.at(-1));
    engine.callTool('ui.openCanvas', { libraryPath: root, path: 'Mapa.canvas' });
    state = commands.applyUiCommand(state, seen.at(-1));
    assert.equal(state.view, 'canvas');
    assert.equal(state.placeholder, true);
    assert.equal(state.theme, 'dark');
    assert.equal(state.workspace, 'Estudos');
    assert.deepEqual(
      seen.map((command) => command.type),
      ['openNote', 'showGraph', 'setTheme', 'openCanvas'],
    );
    stop();
    assert.throws(
      () => engine.callTool('ui.openNote', { libraryPath: root, path: 'Nota.md' }),
      /A interface não está aberta/,
    );
  } finally {
    stop();
  }
});

test('wikiQuery ignora um [[ esquecido no meio do texto', () => {
  const commands = require('../src/ui/commands.js');
  const text = 'liga a um [[ incompleto. **vivo**';
  assert.equal(commands.wikiQuery(text, text.length), null);
  assert.equal(commands.wikiQuery(`[[${'a'.repeat(61)}`, 63), null);
});
