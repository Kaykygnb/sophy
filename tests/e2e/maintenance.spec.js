const { test, expect, _electron: electron } = require('@playwright/test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function issueMcpKey(nome) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-e2e-mcp-'));
  const script = `import { createClient } from './engine/mcp-clients.ts';
const created = createClient(${JSON.stringify(userData)}, { nome: ${JSON.stringify(nome)}, permissao: 'escrita' });
process.stdout.write(created.chave);
`;
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script],
    { encoding: 'utf8', cwd: path.resolve(__dirname, '../..') },
  );
  if (result.status !== 0) throw new Error(result.stderr || 'não criei a chave MCP');
  return { userData, chave: result.stdout };
}

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-maintenance-'));
  fs.mkdirSync(path.join(root, '.sophy'));
  fs.writeFileSync(path.join(root, 'Nota.md'), 'Original\n\nApagar\n');
  fs.writeFileSync(path.join(root, 'Outra.md'), 'Outra nota\n');
  return root;
}

async function launch() {
  const roots = [library(), library()];
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-maintenance-data-'));
  fs.writeFileSync(
    path.join(data, 'ui.json'),
    JSON.stringify({ onboarded: true, libraryPath: roots[0], libraries: roots }),
  );
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', '--test-user-data=' + data], env });
  const page = await app.firstWindow();
  await page.locator('#arvore [data-open="Nota.md"]').click();
  return { app, page, roots, data };
}

test('trocar biblioteca salva a edição pendente e permite abrir a próxima nota', async () => {
  const { app, page, roots } = await launch();
  try {
    await page.locator('.bloco--texto').first().click();
    await page.keyboard.type(' PENDENTE');
    await page.locator('#seletor-biblioteca').click();
    await page.getByRole('menuitem', { name: path.basename(roots[1]), exact: true }).click();
    await expect
      .poll(() => fs.readFileSync(path.join(roots[0], 'Nota.md'), 'utf8'))
      .toContain('PENDENTE');
    await page.locator('#arvore [data-open="Nota.md"]').click();
    await expect(page.locator('.bloco--texto').first()).toContainText('Original');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

for (const action of ['trocar', 'aba', 'janela']) {
  test(`falha de gravação cancela ${action} e preserva o editor`, async () => {
    const { app, page, roots } = await launch();
    try {
      await page.evaluate(() => {
        const original = tool;
        tool = async (name, input) => {
          if (name === 'note.write') throw new Error('Disco indisponível no teste');
          return original(name, input);
        };
      });
      await page.locator('.bloco--texto').first().click();
      await page.keyboard.type(' NAO_PERDER');
      if (action === 'trocar') {
        await page.locator('#seletor-biblioteca').click();
        await page.getByRole('menuitem', { name: path.basename(roots[1]), exact: true }).click();
      } else if (action === 'aba')
        await page.getByRole('button', { name: 'Fechar Nota', exact: true }).click();
      else await page.getByRole('button', { name: 'Fechar', exact: true }).click();
      await expect(page.locator('.toast--erro').first()).toContainText('Disco indisponível');
      await expect(page.locator('.bloco--texto').first()).toContainText('NAO_PERDER');
      expect(await page.evaluate(() => state.libraryPath)).toBe(roots[0]);
      expect(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      ).toBe(true);
      expect(fs.readFileSync(path.join(roots[0], 'Nota.md'), 'utf8')).not.toContain('NAO_PERDER');
    } finally {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    }
  });
}

test('fechar janela com conflito permite cancelar antes de ocultar', async () => {
  const { app, page, roots } = await launch();
  try {
    fs.writeFileSync(path.join(roots[0], 'Nota.md'), 'EXTERNO\n');
    await page.locator('.bloco--texto').first().click();
    await page.keyboard.type(' MINHA_JANELA');
    await expect(page.locator('.aviso').filter({ hasText: 'mudou desde a leitura' })).toBeVisible();
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Conflito', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.bloco--texto').first()).toContainText('MINHA_JANELA');
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    ).toBe(true);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

for (const action of ['Cancelar', 'Manter', 'Descartar']) {
  test(`fechar aba em conflito: ${action}`, async () => {
    const { app, page, roots } = await launch();
    try {
      fs.writeFileSync(path.join(roots[0], 'Nota.md'), 'EXTERNO\n');
      await page.locator('.bloco--texto').first().click();
      await page.keyboard.type(' LOCAL');
      await expect(page.locator('.aviso').filter({ hasText: 'mudou desde a leitura' })).toBeVisible();
      await page.getByRole('button', { name: 'Fechar Nota', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Conflito', exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Descartar', exact: true })).toHaveClass(
        /perigo/,
      );
      if (action === 'Cancelar') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: action, exact: true }).click();
      await expect(page.locator('[data-tab="Nota.md"]')).toHaveCount(action === 'Cancelar' ? 1 : 0);
      const body = fs
        .readFileSync(path.join(roots[0], 'Nota.md'), 'utf8')
        .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
      if (action === 'Manter') expect(body).toContain('LOCAL');
      else expect(body).toBe('EXTERNO\n');
      if (action === 'Cancelar')
        await expect(page.locator('.bloco--texto').first()).toContainText('LOCAL');
    } finally {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    }
  });
}

test('excluir bloco e desfazer durante grupo de digitação preserva a edição', async () => {
  const { app, page, roots } = await launch();
  try {
    await page.locator('.bloco--texto').first().click();
    await page.keyboard.type(' editado');
    // Segura o limite do grupo sem depender da carga da máquina ou de esperas.
    await page.evaluate(() => clearTimeout(state.undoTimer));
    const index = await page
      .locator('.bloco--texto', { hasText: 'Apagar' })
      .getAttribute('data-block');
    await page.locator(`[data-menu="${index}"]`).click({ force: true });
    await page.locator('[data-bloco="apagar"]').click();
    await page.keyboard.press('Control+z');
    await expect
      .poll(() => fs.readFileSync(path.join(roots[0], 'Nota.md'), 'utf8'))
      .toContain('editado');
    await expect(page.locator('.bloco--texto', { hasText: 'Apagar' })).toBeVisible();
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('motor sem janela grava em outra biblioteca e MCP reabre a interface no destino', async () => {
  const { app, page, roots, data } = await launch();
  let client;
  try {
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
      .toBe(false);
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const issued = issueMcpKey('Manutencao');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([, value]) => typeof value === 'string'),
    );
    env.SOPHY_UI_DIR = path.join(data, 'presenca');
    env.SOPHY_USER_DATA = issued.userData;
    env.SOPHY_MCP_KEY = issued.chave;
    client = new Client({ name: 'daemon-e2e', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          '--experimental-strip-types',
          path.resolve('engine/cli.ts'),
          'mcp',
          '--todas-bibliotecas',
          '--catalogo',
          path.join(data, 'ui.json'),
          '--escrita',
        ],
        env,
        stderr: 'pipe',
      }),
    );
    const call = (name, input) => client.callTool({ name, arguments: input });
    const catalog = await call('library.list', {});
    const second = JSON.parse(catalog.content[0].text).find((entry) => entry.root === roots[1]);
    const created = await call('note.create', {
      libraryId: second.id,
      path: 'Remota.md',
      body: 'FEITA_SEM_JANELA\n',
    });
    expect(created.isError).not.toBe(true);
    expect(fs.readFileSync(path.join(roots[1], 'Remota.md'), 'utf8')).toContain('FEITA_SEM_JANELA');
    expect(await page.evaluate(() => state.libraryPath)).toBe(roots[0]);
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    ).toBe(false);
    expect(
      (await call('ui.openNote', { libraryId: second.id, path: 'Remota.md' })).isError,
    ).not.toBe(true);
    await expect(page.locator('.bloco--texto').first()).toContainText('FEITA_SEM_JANELA');
    expect(await page.evaluate(() => state.libraryPath)).toBe(roots[1]);
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    ).toBe(true);
    await call('ui.setLayout', { libraryId: second.id, sidebar: false, focus: true });
    await expect(page.locator('#shell')).toHaveClass(/is-foco/);
    await expect(page.locator('#lateral')).toHaveClass(/is-fechada/);
  } finally {
    await client?.close();
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('iniciar em segundo plano não cria janela e um comando visual abre a nota', async () => {
  const root = library();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-maintenance-background-'));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ['.', '--background', '--test-user-data=' + data, '--biblioteca=' + root],
    env,
  });
  let client;
  try {
    await expect.poll(() => fs.existsSync(path.join(data, 'presenca', 'lock'))).toBe(true);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    const issued = issueMcpKey('Segundo plano');
    client = new Client({ name: 'background', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          '--experimental-strip-types',
          path.resolve('engine/cli.ts'),
          'mcp',
          '--biblioteca',
          root,
          '--escrita',
        ],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([, value]) => typeof value === 'string'),
          ),
          SOPHY_UI_DIR: path.join(data, 'presenca'),
          SOPHY_USER_DATA: issued.userData,
          SOPHY_MCP_KEY: issued.chave,
        },
        stderr: 'pipe',
      }),
    );
    const result = await client.callTool({ name: 'ui.openNote', arguments: { path: 'Nota.md' } });
    expect(result.isError).not.toBe(true);
    const page = await app.firstWindow();
    await expect(page.locator('.bloco--texto').first()).toContainText('Original');
    expect(await page.evaluate(() => state.active)).toBe('Nota.md');
    // Encerramento explícito passa pela mesma verificação de salvamento.
    await page.locator('.bloco--texto').first().click();
    await page.keyboard.type(' SAIDA_EXPLICITA');
    const closed = app.waitForEvent('close');
    await page.evaluate(() => {
      sophy.window('quit');
    });
    await closed;
    expect(fs.readFileSync(path.join(root, 'Nota.md'), 'utf8')).toContain('SAIDA_EXPLICITA');
  } finally {
    await client?.close();
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('lixeira da interface recusa metadados internos', async () => {
  const { app, page, roots } = await launch();
  try {
    const result = await page.evaluate(() => sophy.tool('entry.trash', { path: '.sophy' }));
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(roots[0], '.sophy'))).toBe(true);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

for (const choice of ['Cancelar', 'Manter', 'Descartar']) {
  test(`troca de biblioteca em conflito: ${choice}`, async () => {
    const { app, page, roots } = await launch();
    try {
      fs.writeFileSync(path.join(roots[0], 'Nota.md'), 'EXTERNO\n');
      await page.locator('.bloco--texto').first().click();
      await page.keyboard.type(' TROCA_LOCAL');
      await expect(page.locator('.aviso').filter({ hasText: 'mudou desde a leitura' })).toBeVisible();
      await page.locator('#seletor-biblioteca').click();
      await page.getByRole('menuitem', { name: path.basename(roots[1]), exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Conflito', exact: true });
      await expect(dialog).toBeVisible();
      if (choice === 'Cancelar') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: choice, exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => state.libraryPath))
        .toBe(roots[choice === 'Cancelar' ? 0 : 1]);
      const body = fs
        .readFileSync(path.join(roots[0], 'Nota.md'), 'utf8')
        .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
      if (choice === 'Manter') expect(body).toContain('TROCA_LOCAL');
      else expect(body).toBe('EXTERNO\n');
    } finally {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    }
  });
}

test('criar biblioteca não redireciona a gravação da nota atual', async () => {
  const { app, page, roots } = await launch();
  try {
    await page.locator('.bloco--texto').first().click();
    await page.keyboard.type(' ORIGINAL_CONTINUA');
    const result = await page.evaluate(
      (folder) => sophy.createLibrary(folder),
      path.join(roots[1], 'Nova'),
    );
    expect(result.ok).toBe(true);
    await page.keyboard.press('Control+s');
    await expect
      .poll(() => fs.readFileSync(path.join(roots[0], 'Nota.md'), 'utf8'))
      .toContain('ORIGINAL_CONTINUA');
    expect(fs.existsSync(path.join(roots[1], 'Nova', 'Nota.md'))).toBe(false);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('fechar canvas inativo não remove a edição da nota ativa', async () => {
  const { app, page, roots } = await launch();
  try {
    fs.writeFileSync(path.join(roots[0], 'Mapa.canvas'), JSON.stringify({ nodes: [], edges: [] }));
    await page.evaluate(async () => {
      await refreshLibrary();
      paintTree();
    });
    await page.locator('#arvore [data-canvas="Mapa.canvas"]').click();
    await page.locator('#arvore [data-open="Nota.md"]').click();
    await page.locator('.bloco--texto').first().click();
    await page.keyboard.type(' NOTA_ATIVA');
    await page.getByRole('button', { name: 'Fechar Mapa', exact: true }).click();
    await expect(page.locator('.bloco--texto').first()).toContainText('NOTA_ATIVA');
    await expect
      .poll(() => fs.readFileSync(path.join(roots[0], 'Nota.md'), 'utf8'))
      .toContain('NOTA_ATIVA');
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test('falha ao salvar canvas impede abandonar o quadro pela navegação', async () => {
  const { app, page, roots } = await launch();
  try {
    fs.writeFileSync(path.join(roots[0], 'Mapa.canvas'), JSON.stringify({ nodes: [], edges: [] }));
    await page.evaluate(async () => {
      await openCanvas('Mapa.canvas');
      const original = tool;
      tool = async (name, input) => {
        if (name === 'canvas.update') throw new Error('Canvas não pôde ser gravado');
        return original(name, input);
      };
      await saveCanvas({ nodes: [{ id: 'local', type: 'text', text: 'NAO_PERDER_CANVAS', x: 0, y: 0, width: 200, height: 100 }], edges: [] });
    });
    await page.locator('[data-nav="inicio"]').click();
    expect(await page.evaluate(() => state.view)).toBe('canvas');
    expect(await page.evaluate(() => state.canvasDoc.nodes[0].text)).toBe('NAO_PERDER_CANVAS');
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }
});
