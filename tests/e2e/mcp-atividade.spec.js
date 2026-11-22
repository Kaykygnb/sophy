const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PRINTS = process.env.MCP_PRINTS || '';

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-mcp-lib-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Estudos', 'Leitura.md'), '# Leitura\n\nTexto.\n');
  return root;
}

async function launch(theme = 'light', root = library()) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-mcp-data-'));
  fs.writeFileSync(
    path.join(userData, 'ui.json'),
    JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme }),
  );
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1360, 860));
  return { app, page, root, userData };
}

const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

/* Mock do contrato do Fernando: `window.sophy.mcpAdmin` e `window.sophy.tool('activity.*')`.
   O que não é activity.* continua no motor de verdade. */
async function installMocks(app, options = {}) {
  await app.evaluate(({ ipcMain }, options) => {
    const calls = (globalThis.__mcpCalls = []);
    const clients = (globalThis.__clients = options.clients
      ? JSON.parse(JSON.stringify(options.clients))
      : []);
    let legacy = {
      ativo: false,
      aviso:
        'Com o legado desligado, a configuração atual do Codex e do Claude sem chave passa a receber chave_invalida.',
    };
    let seq = 1;
    const fail = (code, message) => Object.assign(new Error(message || code), { code });
    ipcMain.removeHandler('sophy:mcp-admin');
    ipcMain.handle('sophy:mcp-admin', async (_event, tool, input) => {
      calls.push({ canal: 'admin', tool, input });
      try {
        let value;
        if (tool === 'mcp.clients.list') value = clients.map((c) => ({ ...c }));
        else if (tool === 'mcp.clients.create') {
          if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'()-]{0,39}$/u.test(String(input.nome || '').trim()))
            throw fail('nome_invalido', 'nome');
          if (clients.some((c) => c.nome.toLowerCase() === input.nome.trim().toLowerCase()))
            throw fail('nome_em_uso', 'em uso');
          const key = `sph_${'ab12cd34'.repeat(8)}${seq}`;
          const client = {
            id: `c${seq}`,
            nome: input.nome.trim(),
            permissao: input.permissao,
            ativo: true,
            final: '…cd34',
            criadoEm: new Date().toISOString(),
            ultimoUso: null,
          };
          seq += 1;
          clients.push(client);
          value = { id: client.id, nome: client.nome, permissao: client.permissao, chave: key };
          globalThis.__lastKey = key;
        } else if (tool === 'mcp.clients.toggle') {
          const client = clients.find((c) => c.id === input.id);
          if (!client) throw fail('cliente_inexistente');
          client.ativo = input.ativo;
          value = { ...client };
        } else if (tool === 'mcp.clients.revoke') {
          const index = clients.findIndex((c) => c.id === input.id);
          if (index < 0) throw fail('cliente_inexistente');
          clients.splice(index, 1);
          value = { id: input.id, removido: true };
        } else if (tool === 'mcp.clients.snippet') {
          const id = `sophy-${input.nome}`;
          value = {
            stdio: {
              codex: `[mcp_servers.${id}]\ncommand = "node"\nargs = ["--experimental-strip-types", "engine/cli.ts", "mcp"]\n\n[mcp_servers.${id}.env]\nSOPHY_MCP_KEY = "${input.chave}"\n`,
              claude: JSON.stringify(
                {
                  mcpServers: {
                    [id]: {
                      command: 'node',
                      args: ['engine/cli.ts', 'mcp'],
                      env: { SOPHY_MCP_KEY: input.chave },
                    },
                  },
                },
                null,
                2,
              ),
            },
            http: {
              codex: `[mcp_servers.${id}]\nurl = "http://127.0.0.1:8734/mcp"\nhttp_headers = { Authorization = "Bearer ${input.chave}" }\n`,
              claude: JSON.stringify(
                {
                  mcpServers: {
                    [id]: {
                      type: 'http',
                      url: 'http://127.0.0.1:8734/mcp',
                      headers: { Authorization: `Bearer ${input.chave}` },
                    },
                  },
                },
                null,
                2,
              ),
            },
          };
        } else if (tool === 'mcp.legacy.get') value = { ...legacy };
        else if (tool === 'mcp.legacy.set') {
          legacy = { ...legacy, ativo: input.ativo === true };
          value = { ...legacy };
        } else throw fail('not-found');
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: error.message, code: error.code };
      }
    });

    // atividade
    const rows = (globalThis.__activity = (options.activity || []).map((row) => ({ ...row })));
    const real = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get('sophy:tool');
    globalThis.__realTool = real;
    ipcMain.removeHandler('sophy:tool');
    ipcMain.handle('sophy:tool', async (event, name, input) => {
      if (!/^activity\./.test(name))
        return real ? real(event, name, input) : { ok: false, error: 'sem motor' };
      calls.push({ canal: 'tool', tool: name, input });
      try {
        if (name === 'activity.list') {
          let list = rows.slice();
          if (input.autor) list = list.filter((r) => r.autor === input.autor);
          if (input.de) list = list.filter((r) => Date.parse(r.quando) >= Date.parse(input.de));
          list.sort((a, b) => (a.quando < b.quando ? 1 : -1));
          return {
            ok: true,
            value: list.slice(0, input.limite || 50).map(({ antes, depois, ...rest }) => rest),
          };
        }
        if (name === 'activity.diff') {
          const row = rows.find((r) => r.id === input.id);
          if (!row) throw fail('atividade_inexistente', 'Não encontrei essa atividade.');
          return { ok: true, value: { antes: row.antes, depois: row.depois } };
        }
        if (name === 'activity.undo') {
          const row = rows.find((r) => r.id === input.id);
          if (!row) throw fail('atividade_inexistente', 'Não encontrei essa atividade.');
          if (row.conflito && input.forcar !== true)
            return { ok: true, value: { erro: 'conflito', versionIdAtual: 'v-atual' } };
          const novo = {
            id: `u${rows.length}`,
            autor: 'usuario',
            tool: 'activity.undo',
            label: `Desfazer ${row.label}`,
            notePath: row.notePath,
            versionId: 'v-undo',
            quando: new Date().toISOString(),
            antes: row.depois,
            depois: row.antes,
          };
          rows.push(novo);
          return {
            ok: true,
            value: { id: novo.id, desfeito: row.id, autor: 'usuario', versionId: 'v-undo' },
          };
        }
        throw fail('not-found');
      } catch (error) {
        return { ok: false, error: error.message, code: error.code };
      }
    });
  }, options);
}

const calls = (app, filter) =>
  app.evaluate(
    (_e, filter) => globalThis.__mcpCalls.filter((c) => !filter || c.tool === filter),
    filter,
  );

const CLIENTS = [
  {
    id: 'k1',
    nome: 'Codex',
    permissao: 'escrita',
    ativo: true,
    final: '…ab12',
    criadoEm: ago(60 * 24 * 3),
    ultimoUso: ago(4),
  },
  {
    id: 'k2',
    nome: 'Claude',
    permissao: 'leitura',
    ativo: true,
    final: '…9f3e',
    criadoEm: ago(60 * 24 * 2),
    ultimoUso: null,
  },
  {
    id: 'k3',
    nome: 'Cursor',
    permissao: 'escrita',
    ativo: false,
    final: '…77c0',
    criadoEm: ago(60 * 24),
    ultimoUso: ago(60 * 30),
  },
];

const ACTIVITY = [
  {
    id: 'a1',
    autor: 'mcp:Codex',
    tool: 'note.update',
    label: 'Reescreveu o resumo',
    notePath: 'Estudos/Leitura.md',
    versionId: 'v1',
    quando: ago(4),
    conflito: true,
    antes:
      '# Leitura\n\nTexto antigo da nota.\nUma linha que fica.\nOutra linha que fica.\nMais uma.\nE mais uma.\nE outra ainda.\nE mais outra.\nLinha 1.\nLinha 2.\nLinha 3.\nLinha 4.\nLinha 5.\nFinal.\n',
    depois:
      '# Leitura\n\nTexto novo da nota, bem melhor.\nUma linha que fica.\nOutra linha que fica.\nMais uma.\nE mais uma.\nE outra ainda.\nE mais outra.\nLinha 1.\nLinha 2.\nLinha 3.\nLinha 4.\nLinha 5.\nFinal.\nUma linha nova no fim.\n',
  },
  {
    id: 'a2',
    autor: 'sofi',
    tool: 'note.create',
    label: 'Criou a nota Reunião de segunda',
    notePath: 'Reunião.md',
    versionId: 'v2',
    quando: ago(8),
    antes: null,
    depois: '# Reunião\n\n- [ ] Revisar o plano\n- [ ] Enviar a ata\n',
  },
  {
    id: 'a3',
    autor: 'usuario',
    tool: 'note.update',
    label: 'Editou Plano',
    notePath: 'Estudos/Plano.md',
    versionId: 'v3',
    quando: ago(12),
    antes: '# Plano\n\nA\n',
    depois: '# Plano\n\nA\nB\n',
  },
  {
    id: 'a4',
    autor: 'mcp:Claude',
    tool: 'note.read',
    label: 'Leu a nota Plano',
    notePath: null,
    versionId: null,
    quando: ago(60 * 26),
    antes: null,
    depois: null,
  },
  {
    id: 'a5',
    autor: 'mcp:Codex',
    tool: 'note.move',
    label: 'Moveu Ideias para Estudos',
    notePath: 'Estudos/Ideias.md',
    versionId: 'v5',
    quando: ago(60 * 24 * 10),
    antes: '# Ideias\n',
    depois: '# Ideias\n',
  },
];

async function openMcpSettings(page) {
  await page.keyboard.press('Control+,');
  await page.locator('[data-cfg-secao="mcp"]').click();
  await expect(page.locator('#cfg-mcp h3')).toHaveText('Acesso por MCP');
}

async function shot(page, name, theme, locator) {
  if (!PRINTS) return;
  fs.mkdirSync(PRINTS, { recursive: true });
  const target = path.join(PRINTS, `${name}-${theme}.png`);
  if (locator) await locator.screenshot({ path: target });
  else await page.screenshot({ path: target });
}

test('MCP: estado vazio útil e passo a passo (nome, permissão, chave uma vez, snippets e Copiar)', async () => {
  const { app, page } = await launch();
  try {
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().waitFor();
    await installMocks(app, {});
    await openMcpSettings(page);
    const section = page.locator('#cfg-mcp');
    await expect(section.locator('[data-mcp-vazio]')).toContainText(
      'Nenhum agente conectado ainda',
    );
    await expect(section).toContainText('cada agente recebe a própria chave');
    await section.getByRole('button', { name: 'Conectar um agente' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Conectar um agente' });
    await expect(dialog).toBeVisible();
    // nome inválido não avança
    await dialog.getByRole('button', { name: 'Continuar' }).click();
    await expect(dialog).toContainText('Dê um nome ao agente.');
    await dialog.getByRole('button', { name: 'Codex', exact: true }).click(); // sugestão
    await expect(dialog.locator('#mcp-nome')).toHaveValue('Codex');
    await dialog.getByRole('button', { name: 'Continuar' }).click();

    // permissão: explica o que fica só no app
    await expect(dialog).toContainText('O que Codex pode fazer?');
    await expect(dialog).toContainText('Fica só no app');
    await expect(dialog).toContainText('Esvaziar a lixeira');
    await dialog.locator('.mcp-opcao', { hasText: 'Leitura e escrita' }).click();
    await dialog.getByRole('button', { name: 'Criar chave' }).click();

    // chave aparece, com aviso e Copiar
    const key = dialog.locator('[data-mcp-chave]');
    await expect(key).toHaveText(/^sph_/);
    await expect(dialog).toContainText('Guarde agora, não aparece de novo.');
    const chave = await app.evaluate(() => globalThis.__lastKey);
    await expect(key).toHaveText(chave);
    await dialog.getByRole('button', { name: 'Copiar' }).click();
    await expect(dialog).toContainText('Chave copiada.');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(chave);
    // o contrato: create {nome, permissao} e snippet logo depois, com a chave
    expect((await calls(app, 'mcp.clients.create'))[0].input).toEqual({
      nome: 'Codex',
      permissao: 'escrita',
    });
    expect((await calls(app, 'mcp.clients.snippet'))[0].input).toEqual({ nome: 'Codex', chave });
    await shot(page, '02-passo-chave', 'claro', dialog);
    await dialog.getByRole('button', { name: 'Continuar' }).click();

    // snippets em abas
    const code = dialog.locator('[data-mcp-snippet]');
    await expect(code).toContainText('[mcp_servers.sophy-Codex]');
    await expect(code).toContainText('SOPHY_MCP_KEY');
    await dialog.getByRole('tab', { name: 'Claude' }).click();
    await expect(code).toContainText('"mcpServers"');
    await dialog.getByRole('tab', { name: 'HTTP' }).click();
    await expect(code).toContainText('Bearer');
    await expect(dialog).toContainText('sophy mcp --http');
    await dialog.getByRole('tab', { name: 'Codex' }).click();
    await dialog.getByRole('tab', { name: 'stdio (padrão)' }).click();
    await dialog.getByRole('button', { name: 'Copiar' }).click();
    await expect(dialog.locator('.mcp-codigo__copiar')).toContainText('Copiado');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain(
      '[mcp_servers.sophy-Codex]',
    );
    await shot(page, '03-passo-snippet', 'claro', dialog);

    // voltar mostra a chave de novo; concluir faz a chave sumir
    await dialog.getByRole('button', { name: 'Ver a chave de novo' }).click();
    await expect(key).toHaveText(chave);
    await dialog.getByRole('button', { name: 'Continuar' }).click();
    await dialog.getByRole('button', { name: 'Concluir' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('sph_');
    const row = section.locator('.mcp-cliente[data-nome="Codex"]');
    await expect(row).toContainText('Escrita');
    await expect(row).toContainText('…cd34');
    await expect(row).toContainText('Ainda não foi usado');
  } finally {
    await app.close();
  }
});

test('MCP: nome repetido avisa no passo do nome; fechar sem copiar a chave pede confirmação', async () => {
  const { app, page } = await launch();
  try {
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().waitFor();
    await installMocks(app, { clients: CLIENTS });
    await openMcpSettings(page);
    await page.locator('#cfg-mcp').getByRole('button', { name: 'Conectar um agente' }).click();
    const dialog = page.getByRole('dialog', { name: 'Conectar um agente' });
    await dialog.locator('#mcp-nome').fill('codex');
    await dialog.getByRole('button', { name: 'Continuar' }).click();
    await dialog.getByRole('button', { name: 'Criar chave' }).click();
    await expect(dialog).toContainText('Como se chama esse agente?');
    await expect(dialog.locator('#mcp-nome-erro')).toContainText(
      'Já existe um agente com esse nome',
    );
    await dialog.locator('#mcp-nome').fill('Aider');
    await dialog.getByRole('button', { name: 'Continuar' }).click();
    await dialog.getByRole('button', { name: 'Criar chave' }).click();
    await expect(dialog.locator('[data-mcp-chave]')).toHaveText(/^sph_/);
    await page.keyboard.press('Escape');
    await expect(dialog.getByRole('alertdialog')).toContainText('Fechar sem copiar a chave?');
    await dialog.getByRole('button', { name: 'Voltar à chave' }).click();
    await expect(dialog.locator('[data-mcp-chave]')).toBeVisible();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: 'Fechar mesmo assim' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('sph_');
    await expect(page.locator('.mcp-cliente[data-nome="Aider"]')).toBeVisible(); // o agente foi criado
  } finally {
    await app.close();
  }
});

test('MCP: lista de clientes, interruptor ativo/desativado e Revogar com confirmação', async () => {
  const { app, page } = await launch();
  try {
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().waitFor();
    await installMocks(app, { clients: CLIENTS });
    await openMcpSettings(page);
    const section = page.locator('#cfg-mcp');
    await expect(section.locator('.mcp-cliente')).toHaveCount(3);
    const codex = section.locator('.mcp-cliente[data-nome="Codex"]');
    await expect(codex).toContainText('Escrita');
    await expect(codex).toContainText('…ab12');
    await expect(codex).toContainText('Último uso');
    await expect(section.locator('.mcp-cliente[data-nome="Claude"]')).toContainText('Leitura');
    await expect(section.locator('.mcp-cliente[data-nome="Cursor"]')).toContainText('Desativado');
    await shot(page, '01-lista-clientes', 'claro', page.locator('.config__corpo'));

    // interruptor
    await codex.getByRole('switch').uncheck();
    await expect(codex).toContainText('Desativado');
    expect((await calls(app, 'mcp.clients.toggle'))[0].input).toEqual({ id: 'k1', ativo: false });
    await page.locator('.mcp-cliente[data-nome="Codex"]').getByRole('switch').check();
    await expect(page.locator('.mcp-cliente[data-nome="Codex"]')).not.toContainText('Desativado');

    // Revogar: cancelar não revoga
    await section
      .locator('.mcp-cliente[data-nome="Claude"]')
      .getByRole('button', { name: /Revogar/ })
      .click();
    const dialog = page.getByRole('dialog', { name: /Revogar o acesso de Claude/ });
    await expect(dialog).toContainText('a chave não volta');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(section.locator('.mcp-cliente')).toHaveCount(3);
    expect(await calls(app, 'mcp.clients.revoke')).toHaveLength(0);
    // confirmar revoga
    await section
      .locator('.mcp-cliente[data-nome="Claude"]')
      .getByRole('button', { name: /Revogar/ })
      .click();
    await page
      .getByRole('dialog', { name: /Revogar o acesso de Claude/ })
      .getByRole('button', { name: 'Revogar acesso' })
      .click();
    await expect(section.locator('.mcp-cliente')).toHaveCount(2);
    expect((await calls(app, 'mcp.clients.revoke'))[0].input).toEqual({ id: 'k2' });
    await expect(
      page.locator('.toast').filter({ hasText: 'Acesso de Claude revogado.' }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});

test('MCP: legado desligado por padrão, com o aviso do motor e confirmação', async () => {
  const { app, page } = await launch();
  try {
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().waitFor();
    await installMocks(app, { clients: CLIENTS });
    await openMcpSettings(page);
    const legacy = page.locator('#mcp-legado');
    await expect(legacy).not.toBeChecked();
    await expect(page.locator('#mcp-legado-aviso')).toContainText('passa a receber chave_invalida');
    await page.locator('#mcp-legado-aviso').scrollIntoViewIfNeeded();
    await shot(page, '04-aviso-legado', 'claro', page.locator('.config__corpo'));

    await legacy.click();
    const dialog = page.getByRole('dialog', { name: 'Aceitar conexões sem chave?' });
    await expect(dialog).toContainText('passa a receber chave_invalida'); // aviso do motor também na confirmação
    await shot(page, '05-confirma-legado', 'claro');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(legacy).not.toBeChecked();
    expect(await calls(app, 'mcp.legacy.set')).toHaveLength(0);

    await legacy.click();
    await page
      .getByRole('dialog', { name: 'Aceitar conexões sem chave?' })
      .getByRole('button', { name: 'Aceitar sem chave' })
      .click();
    await expect(legacy).toBeChecked();
    expect((await calls(app, 'mcp.legacy.set'))[0].input).toEqual({ ativo: true });
    await expect(page.locator('#mcp-legado-aviso')).toHaveClass(/mcp-aviso--ligado/);

    await legacy.click();
    await page
      .getByRole('dialog', { name: 'Desligar as conexões sem chave?' })
      .getByRole('button', { name: 'Desligar o legado' })
      .click();
    await expect(legacy).not.toBeChecked();
    expect((await calls(app, 'mcp.legacy.set'))[1].input).toEqual({ ativo: false });
  } finally {
    await app.close();
  }
});

test('Atividade: entrada em EXPLORAR, linha do tempo, filtros por autor e período, link para o MCP', async () => {
  const { app, page } = await launch();
  try {
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().waitFor();
    await installMocks(app, { clients: CLIENTS, activity: ACTIVITY });
    const nav = page.locator('.lateral__nav');
    await expect(nav.locator('.nav__grupo', { hasText: 'Explorar' })).toBeVisible();
    await nav.locator('[data-nav="atividade"]').click();
    await expect(page.locator('.atividade__topo h2')).toHaveText('Atividade');
    await expect(nav.locator('[data-nav="atividade"]')).toHaveAttribute('aria-current', 'page');
    const items = page.locator('.atividade__item');
    await expect(items).toHaveCount(5);
    await expect(items.first()).toContainText('Reescreveu o resumo');
    await expect(items.first()).toContainText('Leitura');
    await expect(items.first()).toContainText('Codex');
    await expect(items.first().locator('time')).toHaveText('há 4 min');
    await expect(page.locator('.atividade__dia').first()).toHaveText('Hoje');
    // autores: Você, Sofi e cada agente (inclui o cliente Cursor, que ainda não agiu)
    const authors = page.locator('[data-mcp-autor]');
    await expect(authors).toHaveText(['Todos', 'Você', 'Sofi', 'Claude', 'Codex', 'Cursor']);

    await page.locator('[data-mcp-autor="mcp:Codex"]').click();
    await expect(items).toHaveCount(2);
    await expect(page.locator('[data-mcp-autor="mcp:Codex"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect((await calls(app, 'activity.list')).at(-1).input.autor).toBe('mcp:Codex');
    await page.locator('[data-mcp-autor=""]').click();
    await expect(items).toHaveCount(5);

    await page.getByRole('radio', { name: '7 dias' }).check({ force: true });
    await expect(items).toHaveCount(4);
    await page.getByRole('radio', { name: 'Hoje' }).check({ force: true });
    await expect(items).toHaveCount(3);
    expect((await calls(app, 'activity.list')).at(-1).input.de).toBeTruthy();
    await page.locator('[data-mcp-autor="mcp:Claude"]').click();
    await expect(page.locator('[data-mcp-vazio]')).toContainText('Nada com esses filtros');
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await expect(items).toHaveCount(5);

    // atalho para a tela do MCP
    await page.locator('.atividade__topo').getByRole('button', { name: 'Acesso por MCP' }).click();
    await expect(page.locator('#cfg-mcp h3')).toHaveText('Acesso por MCP');
    await page.locator('#cfg-mcp').getByRole('button', { name: 'Ver atividade' }).click();
    await expect(page.locator('.atividade__topo h2')).toHaveText('Atividade');
  } finally {
    await app.close();
  }
});

test('Atividade: sem registros mostra o estado vazio com a saída', async () => {
  const { app, page } = await launch();
  try {
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().waitFor();
    await installMocks(app, { activity: [] });
    await page.locator('[data-nav="atividade"]').click();
    await expect(page.locator('[data-mcp-vazio]')).toContainText('Nenhuma atividade ainda');
    await shot(page, '09-atividade-vazia', 'claro');
    await page
      .locator('[data-mcp-vazio]')
      .getByRole('button', { name: 'Conectar um agente' })
      .click();
    await expect(page.locator('#cfg-mcp h3')).toHaveText('Acesso por MCP');
  } finally {
    await app.close();
  }
});

test('Atividade: antes e depois lado a lado, com as linhas mudadas marcadas', async () => {
  const { app, page } = await launch();
  try {
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().waitFor();
    await installMocks(app, { clients: CLIENTS, activity: ACTIVITY });
    await page.locator('[data-nav="atividade"]').click();
    await expect(page.locator('.atividade__escolha')).toContainText('Escolha uma ação');
    await page.locator('.atividade__item', { hasText: 'Reescreveu o resumo' }).click();
    const diff = page.locator('.mcp-diff');
    await expect(diff).toBeVisible();
    await expect(diff.locator('.mcp-diff__cab')).toContainText('Antes');
    await expect(diff.locator('.mcp-diff__cab')).toContainText('Depois');
    const changed = diff.locator('.mcp-diff__linha[data-tipo="mudou"]');
    await expect(changed).toHaveCount(1);
    await expect(changed.locator('.mcp-diff__meia--tirou')).toContainText('Texto antigo da nota.');
    await expect(changed.locator('.mcp-diff__meia--pos')).toContainText(
      'Texto novo da nota, bem melhor.',
    );
    const added = diff.locator('.mcp-diff__linha[data-tipo="pos"]');
    await expect(added).toHaveCount(1);
    await expect(added.locator('.mcp-diff__meia--pos')).toContainText('Uma linha nova no fim.');
    await expect(added.locator('.mcp-diff__meia--vazia')).toHaveCount(1);
    await expect(page.locator('.atividade__resumo')).toContainText('+2');
    await expect(page.locator('.atividade__resumo')).toContainText('−1');
    // trecho longo sem mudança fica recolhido, e abre no clique
    const fold = diff.locator('[data-mcp-dobra]');
    await expect(fold).toContainText('linhas iguais');
    const before = await diff.locator('.mcp-diff__linha').count();
    await fold.click();
    expect(await diff.locator('.mcp-diff__linha').count()).toBeGreaterThan(before);
    expect((await calls(app, 'activity.diff'))[0].input).toEqual({ id: 'a1' });
    await shot(page, '07-antes-depois', 'claro');

    // criada: a nota não existia
    await page.locator('.atividade__item', { hasText: 'Criou a nota Reunião' }).click();
    await expect(page.locator('.atividade__resumo')).toContainText(
      'A nota não existia antes: foi criada.',
    );
    await expect(page.locator('.mcp-diff__meia--vazia').first()).toBeAttached();
    // ação sem nota
    await page.locator('.atividade__item', { hasText: 'Leu a nota Plano' }).click();
    await expect(page.locator('.atividade__sem-diff')).toContainText('não há antes e depois');
  } finally {
    await app.close();
  }
});

test('Atividade: Desfazer com conflito oferece "Desfazer assim mesmo" ou Cancelar', async () => {
  const { app, page } = await launch();
  try {
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().waitFor();
    await installMocks(app, { clients: CLIENTS, activity: ACTIVITY });
    await page.locator('[data-nav="atividade"]').click();

    // sem conflito: desfaz direto e o desfazer vira entrada do usuário
    await page.locator('.atividade__item', { hasText: 'Criou a nota Reunião' }).click();
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
    await expect(
      page.locator('.toast').filter({ hasText: 'Desfeito: Criou a nota Reunião de segunda.' }),
    ).toBeVisible();
    const top = page.locator('.atividade__item').first();
    await expect(top).toContainText('Desfazer Criou a nota Reunião de segunda');
    await expect(top).toContainText('Você');
    expect((await calls(app, 'activity.undo'))[0].input).toEqual({ id: 'a2' });

    // com conflito: o motor devolve {erro:'conflito'} e a tela pergunta
    await page.locator('.atividade__item', { hasText: 'Reescreveu o resumo' }).click();
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'A nota mudou depois desta ação' });
    await expect(dialog).toContainText('mudanças mais novas se perdem');
    await expect(dialog.getByRole('button', { name: 'Desfazer assim mesmo' })).toBeVisible();
    await shot(page, '08-dialogo-conflito', 'claro');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toHaveCount(0);
    let undo = await calls(app, 'activity.undo');
    expect(undo.at(-1).input).toEqual({ id: 'a1' }); // sem forcar
    expect(undo.some((c) => c.input.forcar)).toBe(false);
    await expect(
      page.locator('.atividade__item', { hasText: 'Reescreveu o resumo' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'A nota mudou depois desta ação' })
      .getByRole('button', { name: 'Desfazer assim mesmo' })
      .click();
    undo = await calls(app, 'activity.undo');
    expect(undo.at(-1).input).toEqual({ id: 'a1', forcar: true });
    await expect(
      page.locator('.toast').filter({ hasText: 'Desfeito: Reescreveu o resumo.' }),
    ).toBeVisible();
    await expect(page.locator('.atividade__item').first()).toContainText(
      'Desfazer Reescreveu o resumo',
    );
  } finally {
    await app.close();
  }
});

test('dif por linha: alinha o que mudou, o que entrou e o que saiu', async () => {
  const { app, page } = await launch();
  try {
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().waitFor();
    const rows = await page.evaluate(() =>
      SophyMcp.lineDiff('a\nb\nc\n', 'a\nB\nc\nd\n').map((r) => [
        r.tipo,
        r.esq && r.esq.t,
        r.dir && r.dir.t,
      ]),
    );
    expect(rows).toEqual([
      ['igual', 'a', 'a'],
      ['mudou', 'b', 'B'],
      ['igual', 'c', 'c'],
      ['pos', null, 'd'],
    ]);
    const created = await page.evaluate(() => SophyMcp.lineDiff(null, 'x\ny\n').map((r) => r.tipo));
    expect(created).toEqual(['pos', 'pos']);
    const removed = await page.evaluate(() => SophyMcp.lineDiff('x\ny\n', null).map((r) => r.tipo));
    expect(removed).toEqual(['tirou', 'tirou']);
  } finally {
    await app.close();
  }
});

test('motor de verdade: cria o agente, vê a chave uma vez, o legado vem desligado e o desfazer com conflito funciona', async () => {
  const root = library();
  const { app, page } = await launch('light', root);
  try {
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().waitFor();
    const supported = await page.evaluate(async () => {
      const response = await sophy.mcpAdmin('mcp.clients.list', {});
      return response.ok === true;
    });
    test.skip(!supported, 'precisa do PR 45 (mcp.clients)');
    await openMcpSettings(page);
    const section = page.locator('#cfg-mcp');
    await expect(section.locator('[data-mcp-vazio]')).toBeVisible();
    await expect(page.locator('#mcp-legado')).not.toBeChecked();
    await section.getByRole('button', { name: 'Conectar um agente' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Conectar um agente' });
    await dialog.locator('#mcp-nome').fill('Codex');
    await dialog.getByRole('button', { name: 'Continuar' }).click();
    await dialog.getByRole('button', { name: 'Criar chave' }).click();
    await expect(dialog.locator('[data-mcp-chave]')).toHaveText(/^sph_[0-9A-Za-z_-]{20,}$/);
    await dialog.getByRole('button', { name: 'Já guardei, continuar' }).click();
    await expect(dialog.locator('[data-mcp-snippet]')).toContainText(/mcp_servers\.sophy-codex/i);
    await dialog.getByRole('tab', { name: 'Claude' }).click();
    await expect(dialog.locator('[data-mcp-snippet]')).toContainText('mcpServers');
    await dialog.getByRole('button', { name: 'Concluir' }).click();
    await expect(section.locator('.mcp-cliente[data-nome="Codex"]')).toContainText('Leitura');
    await expect(page.locator('body')).not.toContainText('sph_');

    // atividade real: uma nota criada pela tela vira entrada do autor "Você"
    await page.evaluate(async () => {
      const made = await sophy.tool('note.create', {
        path: 'Estudos/Nova.md',
        body: '# Nova\n\nprimeira\n',
      });
      await sophy.tool('note.write', {
        path: 'Estudos/Nova.md',
        body: '# Nova\n\nsegunda\n',
        expectedRevision: made.value.revision,
      });
    });
    await page.locator('[data-nav="atividade"]').click();
    await expect(page.locator('.atividade__item').first()).toBeVisible();
    const count = await page.locator('.atividade__item').count();
    expect(count).toBe(2);
    await page.locator('.atividade__item').first().click();
    await expect(page.locator('.mcp-diff')).toBeVisible();
    await expect(page.locator('.atividade__item').first()).toContainText('Você');

    // a criação ficou para trás: a nota mudou depois, então o motor devolve conflito de verdade
    const created = page.locator('.atividade__item').last();
    await created.click();
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
    const dialog2 = page.getByRole('dialog', { name: 'A nota mudou depois desta ação' });
    await expect(dialog2).toBeVisible();
    expect(fs.readFileSync(path.join(root, 'Estudos', 'Nova.md'), 'utf8')).toContain('segunda'); // nada foi sobrescrito
    await dialog2.getByRole('button', { name: 'Cancelar' }).click();
    expect(fs.readFileSync(path.join(root, 'Estudos', 'Nova.md'), 'utf8')).toContain('segunda');
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'A nota mudou depois desta ação' })
      .getByRole('button', { name: 'Desfazer assim mesmo' })
      .click();
    await expect(page.locator('.toast').filter({ hasText: /^Desfeito/ })).toBeVisible();
    expect(fs.existsSync(path.join(root, 'Estudos', 'Nova.md'))).toBe(false); // voltou a antes da criação
    await expect(page.locator('.atividade__item').first()).toContainText('Desfazer');
  } finally {
    await app.close();
  }
});

for (const theme of ['claro', 'escuro']) {
  test(`prints (${theme}): lista, passos, legado e atividade`, async () => {
    test.skip(!PRINTS, 'só com MCP_PRINTS');
    const { app, page } = await launch(theme === 'escuro' ? 'dark' : 'light');
    try {
      await page.locator('#arvore').getByText('Leitura', { exact: true }).first().waitFor();
      await installMocks(app, { clients: CLIENTS, activity: ACTIVITY });
      await openMcpSettings(page);
      await page.locator('.mcp-lista').scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await shot(page, '01-lista-clientes', theme);
      await page.locator('#mcp-legado-aviso').scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      await shot(page, '04-aviso-legado', theme);
      await page.locator('#mcp-legado').click();
      await page.getByRole('dialog', { name: 'Aceitar conexões sem chave?' }).waitFor();
      await shot(page, '05-confirma-legado', theme);
      await page.getByRole('button', { name: 'Cancelar' }).click();
      await page.locator('#cfg-mcp').getByRole('button', { name: 'Conectar um agente' }).click();
      const dialog = page.getByRole('dialog', { name: 'Conectar um agente' });
      await dialog.locator('#mcp-nome').fill('Aider');
      await shot(page, '02a-passo-nome', theme);
      await dialog.getByRole('button', { name: 'Continuar' }).click();
      await dialog.locator('.mcp-opcao', { hasText: 'Leitura e escrita' }).click();
      await shot(page, '02b-passo-permissao', theme);
      await dialog.getByRole('button', { name: 'Criar chave' }).click();
      await dialog.locator('[data-mcp-chave]').waitFor();
      await shot(page, '02c-passo-chave', theme);
      await dialog.getByRole('button', { name: 'Já guardei, continuar' }).click();
      await dialog.locator('[data-mcp-snippet]').waitFor();
      await shot(page, '03-passo-snippet', theme);
      await dialog.getByRole('tab', { name: 'Claude' }).click();
      await dialog.getByRole('tab', { name: 'HTTP' }).click();
      await shot(page, '03b-passo-snippet-claude-http', theme);
      await dialog.getByRole('button', { name: 'Concluir' }).click();
      await page.locator('[data-nav="atividade"]').click();
      await expect(page.locator('.atividade__item')).toHaveCount(5);
      await page.waitForTimeout(250);
      await shot(page, '06-atividade-linha-do-tempo', theme);
      await page.locator('.atividade__item', { hasText: 'Reescreveu o resumo' }).click();
      await page.locator('.mcp-diff').waitFor();
      await page.waitForTimeout(250);
      await shot(page, '07-antes-depois', theme);
      await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
      await page.getByRole('dialog', { name: 'A nota mudou depois desta ação' }).waitFor();
      await shot(page, '08-dialogo-conflito', theme);
    } finally {
      await app.close();
    }
  });
}
