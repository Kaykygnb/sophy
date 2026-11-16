const { test, expect, _electron } = require('@playwright/test');
const fs = require('fs'),
  path = require('path'),
  os = require('os');
const { WorldManager } = require('../../src/worlds');
test('layout aprovado: bibliotecas, navegação, notas e anexos', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-design-'));
  const data = path.join(base, 'data');
  fs.mkdirSync(data);
  const manager = new WorldManager(path.join(data, 'worlds.json'), {
    home: os.homedir(),
    protectedPaths: [data],
  });
  manager.create('Ciência da Computação', base);
  const area = manager.current().create('Algoritmos e estruturas').workspace;
  manager.current().create('Programação');
  manager.current().create('Sistemas operacionais');
  fs.mkdirSync(path.join(area.path, 'Fundamentos'));
  fs.mkdirSync(path.join(area.path, 'Anexos'));
  fs.writeFileSync(
    path.join(area.path, 'Introdução.md'),
    '# Introdução\n\nUm espaço tranquilo para estudar, conectar ideias e construir conhecimento.\n\n## Para começar\n\n- Organize seus conceitos.\n- Explore novas conexões.\n',
  );
  fs.writeFileSync(path.join(area.path, 'Anexos', 'Referência.txt'), 'Material complementar');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: ['.', `--test-user-data=${data}`], env });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForSelector('.workspace-card');
    await page.screenshot({ path: test.info().outputPath('libraries-review.png') });
    await page
      .getByRole('searchbox', { name: 'Buscar biblioteca', exact: true })
      .fill('não existe');
    if (await page.locator('.workspace-card:visible').count()) throw Error('Filtro de biblioteca');
    await page.getByRole('searchbox', { name: 'Buscar biblioteca', exact: true }).fill('');
    await page.locator('.card-menu summary').click();
    await page.getByRole('button', { name: 'Usar como padrão', exact: true }).click();
    if ((await page.locator('.default-library').count()) !== 1) throw Error('Biblioteca padrão');
    await page.getByRole('button', { name: 'Voltar a esta biblioteca', exact: true }).click();
    await page.waitForSelector('.workspace-card');
    await page.screenshot({ path: test.info().outputPath('home-review.png') });
    await page
      .locator('.workspace-card')
      .filter({ hasText: 'Algoritmos e estruturas' })
      .getByRole('button', { name: 'Abrir estante', exact: true })
      .click();
    await page.waitForSelector('.file-row');
    await page.getByRole('treeitem').filter({ hasText: 'Introdução' }).click();
    await page.frameLocator('iframe:not([hidden])').locator('#title').waitFor();
    await page.screenshot({ path: test.info().outputPath('editor-review.png') });
    if (await page.locator('.file-tree [data-path="Anexos"]').count())
      throw Error('Anexos misturados');
    if ((await page.locator('.attachment-tree [data-path="Anexos"]').count()) !== 1)
      throw Error('Anexos ausentes');
    await page.getByRole('button', { name: 'Expandir navegação', exact: true }).click();
    await page.getByRole('button', { name: 'Recolher navegação', exact: true }).click();
    if (!(await page.locator('.nav-compact').count())) throw Error('Navegação não recolheu');
    await page.getByRole('button', { name: 'Modo de foco', exact: true }).click();
    if (await page.locator('.study-nav').isVisible()) throw Error('Foco manteve navegação');
    await page.getByRole('button', { name: 'Modo de foco', exact: true }).click();
    await page.getByRole('button', { name: 'Página inicial', exact: true }).click();
    await page.waitForSelector('.workspace-card');
    await page.getByRole('button', { name: 'Configurações', exact: true }).click();
    await page.screenshot({ path: test.info().outputPath('settings-review.png') });
    await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
    if ((await page.locator('html').getAttribute('data-theme')) !== 'dark') throw Error('Tema');
    await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir bibliotecas', exact: true }).click();
    await page.getByRole('button', { name: 'Voltar a esta biblioteca', exact: true }).click();
    await page
      .locator('.workspace-card')
      .filter({ hasText: 'Algoritmos e estruturas' })
      .getByRole('button', { name: 'Abrir estante', exact: true })
      .click();
    await page.setViewportSize({ width: 1000, height: 720 });
    await page.screenshot({ path: test.info().outputPath('narrow-review.png') });
    if ((await page.locator('.area-editor').evaluate((e) => e.getBoundingClientRect().width)) < 300)
      throw Error('Editor estreito');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
