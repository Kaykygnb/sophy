const { test, expect, _electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorldManager } = require('../../src/worlds');

let app, page, base, area, original;
test.beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-writing-'));
  const profile = path.join(base, 'profile');
  fs.mkdirSync(profile);
  const worlds = new WorldManager(path.join(profile, 'worlds.json'), {
    home: os.homedir(),
    protectedPaths: [profile],
  });
  worlds.create('Ciência da Computação', base);
  area = worlds.current().create('Algoritmos e estruturas').workspace;
  worlds.current().create('Programação');
  worlds.current().create('Sistemas operacionais');
  original =
    '# Aprender com atenção\n\nUma boa sessão de estudo começa com uma pergunta clara. Escreva o que você entendeu, conecte a ideia ao que já conhece e deixe espaço para revisar.\n\n## Comece pela pergunta\n\n' +
    Array.from(
      { length: 24 },
      (_, index) =>
        `Parágrafo ${index + 1}. Estudar é voltar a uma ideia com uma pergunta melhor. Em vez de acumular respostas, procure os vínculos entre o que acabou de descobrir e o que já faz sentido para você. Reserve um momento para escrever com suas próprias palavras.\n\n`,
    ).join('') +
    '## Para continuar\n\n- Escolher uma pergunta.\n- Relacionar com [[Recursão]].\n- Voltar ao texto com calma.\n';
  fs.writeFileSync(path.join(area.path, 'Aprender com atenção.md'), original);
  fs.writeFileSync(
    path.join(area.path, 'Recursão.md'),
    '## Um problema menor\n\nResolver uma parte menor do problema ajuda a compreender o todo.\n',
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ args: ['.', `--test-user-data=${profile}`], env });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 960),
  );
  await page.getByRole('button', { name: 'Voltar a esta biblioteca', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir estante', exact: true }).first().click();
  await page.locator('.file-tree [data-path="Aprender com atenção.md"]').click();
  await expect(page.frameLocator('iframe:not([hidden])').locator('#title')).toHaveText(
    'Aprender com atenção',
  );
});
test.afterEach(async () => {
  if (app) await app.close();
  app = null;
  fs.rmSync(base, { recursive: true, force: true });
});

test('a coluna de escrita permanece confortável e os controles cabem em cada janela', async () => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const frame = page.frameLocator('iframe:not([hidden])');
  await frame.locator('body').evaluate(() => document.fonts.ready);
  expect(await frame.locator('body').evaluate(() => document.fonts.check('17px Inter'))).toBe(true);
  await expect(page.locator('.app-header')).toBeHidden();
  await expect(page.locator('.area-shell')).toHaveClass(/nav-compact/);
  await expect(frame.locator('.redundant-title')).toBeHidden();
  await expect(frame.locator('#openComments .icon')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Abrir bibliotecas', exact: true })).toBeEnabled();
  const bodyText = frame.locator('#page > .t-text .edit').first();
  expect(await bodyText.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBe(
    17,
  );
  expect((await bodyText.boundingBox()).width).toBeLessThanOrEqual(720.01);
  await page.screenshot({ path: test.info().outputPath('writing-light-1440.png') });

  await page.getByLabel('Conforto de leitura', { exact: true }).click();
  await page.getByLabel('Tamanho do texto', { exact: true }).selectOption('19');
  await page.getByLabel('Largura de leitura', { exact: true }).selectOption('640');
  await page.getByLabel('Espaço entre linhas', { exact: true }).selectOption('1.9');
  await expect
    .poll(() => bodyText.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)))
    .toBe(19);
  expect((await frame.locator('#main').boundingBox()).width).toBeCloseTo(640, 1);
  expect(fs.readFileSync(path.join(area.path, 'Aprender com atenção.md'), 'utf8')).toBe(original);
  await page.getByLabel('Conforto de leitura', { exact: true }).click();
  await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: test.info().outputPath('writing-dark-1440.png') });
  for (const width of [1280, 960, 760, 640]) {
    await app.evaluate(
      ({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setContentSize(value, 820),
      width,
    );
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await page.locator('.area-editor').boundingBox()).width).toBeGreaterThanOrEqual(340);
    expect(
      await bodyText.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBe(19);
    const controls = page.locator(
      '.workspace-topbar button:visible, .workspace-topbar summary:visible, .note-toolbar button:visible, .note-toolbar summary:visible, .note-save-status',
    );
    for (const control of await controls.all()) {
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    await page.screenshot({ path: test.info().outputPath(`writing-dark-${width}.png`) });
  }
  await page.getByRole('button', { name: 'Ocultar arquivos', exact: true }).click();
  await expect(page.locator('.area-files')).toBeHidden();
  expect((await page.locator('.area-editor').boundingBox()).width).toBeGreaterThan(560);
  await page.getByRole('button', { name: 'Mostrar arquivos', exact: true }).click();
  await expect(page.locator('.area-files')).toBeVisible();
  expect(errors).toEqual([]);
});

test('foco e troca de abas preservam o ponto de escrita, o cursor e o salvamento', async () => {
  const frame = page.frameLocator('iframe:not([hidden])');
  const paragraph = frame.locator('#page > .t-text .edit').nth(10);
  await paragraph.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Uma conexão nova.');
  await expect
    .poll(() => fs.readFileSync(path.join(area.path, 'Aprender com atenção.md'), 'utf8'))
    .toContain('Uma conexão nova.');
  const position = await paragraph.evaluate((element) => {
    const selection = getSelection();
    return { scrollY, text: element.textContent, anchor: selection.anchorOffset };
  });
  await page.keyboard.press('Control+Shift+Enter');
  await expect(page.locator('body')).toHaveClass(/focus-mode/);
  await expect(page.locator('.area-files')).toBeHidden();
  expect(await paragraph.evaluate(() => scrollY)).toBeCloseTo(position.scrollY, -1);
  await page.keyboard.type(' Continuo aqui.');
  await expect(paragraph).toContainText('Uma conexão nova. Continuo aqui.');
  await page.screenshot({ path: test.info().outputPath('writing-focus.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/focus-mode/);
  const savedPosition = await paragraph.evaluate(() => scrollY);
  await page.locator('.file-tree [data-path="Recursão.md"]').click();
  await expect(frame.locator('#title')).toHaveText('Recursão');
  await page.getByRole('button', { name: 'Aprender com atenção.md', exact: true }).click();
  await expect(frame.locator('#title')).toHaveText('Aprender com atenção');
  await expect.poll(() => paragraph.evaluate(() => scrollY)).toBeCloseTo(savedPosition, -1);
  await page.keyboard.type(' Retomei.');
  await expect(paragraph).toContainText('Continuo aqui. Retomei.');
  await page.keyboard.press('Control+z');
  await expect(paragraph).not.toContainText('Retomei.');
  let undoSteps = 1;
  while ((await paragraph.textContent()).includes('Continuo aqui.') && undoSteps < 10) {
    await page.keyboard.press('Control+z');
    undoSteps++;
  }
  await expect(paragraph).not.toContainText('Continuo aqui.');
  await expect(paragraph).toContainText('Uma conexão nova.');
  for (let step = 0; step < undoSteps; step++) await page.keyboard.press('Control+Shift+z');
  await expect(paragraph).toContainText('Continuo aqui. Retomei.');
  await expect
    .poll(() => fs.readFileSync(path.join(area.path, 'Aprender com atenção.md'), 'utf8'))
    .toContain('Retomei.');
  await expect(page.locator('.note-word-count')).toContainText('palavras');
  await page.getByRole('button', { name: 'Página inicial', exact: true }).click();
  await expect(page.locator('.app-header')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir comandos', exact: true })).toBeVisible();
  const card = page.locator('.workspace-card').first();
  expect((await card.boundingBox()).width).toBeLessThan(420);
});
