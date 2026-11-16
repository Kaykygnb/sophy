const { test, expect, _electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorldManager } = require('../../src/worlds');

let app, page, base, data;
test.beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-revision-'));
  data = path.join(base, 'profile');
  fs.mkdirSync(data);
});
test.afterEach(async () => {
  if (app) await app.close();
  app = null;
  fs.rmSync(base, { recursive: true, force: true });
});
async function launch() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ args: ['.', `--test-user-data=${data}`], env });
  page = await app.firstWindow();
}

test('boas-vindas usa ações reais, mantém legibilidade e adapta a janela', async () => {
  await launch();
  await expect(
    page.getByRole('heading', { name: 'Um lugar para pensar com calma.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Criar biblioteca', exact: true }).click();
  await expect(page.getByLabel('Nome da biblioteca', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('#modal')).not.toBeVisible();
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    ),
  ).toBe('#4B6284');
  await page.screenshot({ path: test.info().outputPath('welcome.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 800));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(34, 39, 47)',
  );
  await page.screenshot({ path: test.info().outputPath('welcome-dark-narrow.png') });
});

test('editor, grafo e canvas compartilham o tema e preservam arquivos reais', async () => {
  const manager = new WorldManager(path.join(data, 'worlds.json'), {
    home: os.homedir(),
    protectedPaths: [data],
  });
  manager.create('Ciência da Computação', base);
  const area = manager.current().create('Algoritmos e estruturas').workspace;
  fs.writeFileSync(
    path.join(area.path, 'Introdução.md'),
    '## Comece pela pergunta\n\nVeja [[Recursão]].\n',
  );
  fs.writeFileSync(path.join(area.path, 'Recursão.md'), 'Resolver uma parte menor do problema.\n');
  fs.writeFileSync(path.join(area.path, 'Ideia isolada.md'), 'Sem links.\n');
  fs.writeFileSync(
    path.join(area.path, 'Mapa.canvas'),
    JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', x: 0, y: 0, width: 300, height: 200, text: 'Pergunta central' },
      ],
      edges: [],
    }),
  );
  await launch();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'Voltar a esta biblioteca', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir estante', exact: true }).click();
  await page.getByRole('treeitem').filter({ hasText: 'Introdução' }).click();
  const editor = page.frameLocator('iframe.block-editor:not([hidden])');
  await expect(editor.locator('#title')).toHaveText('Introdução');
  await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
  await expect(editor.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(
    await editor.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor),
  ).toBe('rgb(37, 42, 51)');
  await editor.locator('#page .edit').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Nova ideia.');
  await expect
    .poll(() => fs.readFileSync(path.join(area.path, 'Introdução.md'), 'utf8'))
    .toContain('Nova ideia.');
  await page.screenshot({ path: test.info().outputPath('editor-dark.png') });
  await page.keyboard.press('Control+k');
  await page.locator('#paletteInput').fill('Mapa');
  await page.locator('#paletteList button').filter({ hasText: 'Mapa' }).first().click();
  await expect(page.locator('.graph-node')).toHaveCount(3);
  await page.getByRole('searchbox', { name: 'Buscar nota no grafo' }).fill('recursão');
  await expect(page.locator('.graph-node.is-dimmed')).toHaveCount(2);
  await page.getByLabel('Notas sem conexões').uncheck();
  await expect(page.locator('.graph-node:visible')).toHaveCount(2);
  const before = await page.locator('.graph-svg').getAttribute('viewBox');
  await page.getByRole('button', { name: 'Aumentar zoom', exact: true }).click();
  await expect(page.locator('.graph-svg')).not.toHaveAttribute('viewBox', before);
  await page.getByRole('button', { name: 'Enquadrar', exact: true }).click();
  await expect(page.locator('.graph-svg')).toHaveAttribute('viewBox', before);
  await page.screenshot({ path: test.info().outputPath('graph-dark.png') });
  await page.getByRole('button', { name: 'Abrir nota Recursão', exact: true }).press('Enter');
  await expect(editor.locator('#title')).toHaveText('Recursão');
  await page.locator('.file-tree [data-path="Mapa.canvas"]').click();
  await expect(page.locator('.canvas-node-text')).toHaveValue('Pergunta central');
  await page.locator('.canvas-node-text').fill('Pergunta revisada');
  await page.locator('.file-tree [data-path="Introdução.md"]').click();
  await expect
    .poll(
      () => JSON.parse(fs.readFileSync(path.join(area.path, 'Mapa.canvas'), 'utf8')).nodes[0].text,
    )
    .toBe('Pergunta revisada');
  await page.locator('.file-tree [data-path="Mapa.canvas"]').click();
  await expect(page.locator('.canvas-node-text')).toHaveValue('Pergunta revisada');
  await page.screenshot({ path: test.info().outputPath('canvas-dark.png') });
  expect(errors).toEqual([]);
});
