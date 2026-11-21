const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const shots = process.env.SOPHY_ARTIFACTS || '/opt/cursor/artifacts/lixeira';
fs.mkdirSync(shots, { recursive: true });

function env() {
  const copy = { ...process.env };
  delete copy.ELECTRON_RUN_AS_NODE;
  copy.NODE_OPTIONS = '--experimental-strip-types';
  return copy;
}

function writeNote(root, relative, body) {
  const full = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-lixeira-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  writeNote(root, 'Estudos/Leitura.md', '# Leitura\n\nTexto da leitura.\n');
  writeNote(root, 'Estudos/Ação & café.md', '# Café\n\nUma nota com acento.\n');
  writeNote(root, 'Solta.md', '# Solta\n\nSem estante.\n');
  writeNote(root, 'Sumiu/Dentro.md', '# Dentro\n\nA pasta vai sumir.\n');
  writeNote(root, 'Estudos/Conflito.md', '# Conflito\n\nOcupa o caminho.\n');
  const longName = `${'Nota longa '.repeat(8).trim()}.md`;
  writeNote(root, `Estudos/${longName}`, '# Longa\n');
  fs.writeFileSync(path.join(root, 'foto.png'), 'png');
  return { root, longName };
}

async function launch(root, theme = 'light') {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-data-'));
  const app = await electron.launch({
    args: ['.', `--test-user-data=${userData}`, `--biblioteca=${root}`, `--theme=${theme}`],
    env: env(),
  });
  const page = await app.firstWindow();
  await expect(page.locator('[data-nav="lixeira"]')).toBeVisible();
  return { app, page, userData };
}

async function clearToasts(page) {
  await page.locator('#toasts').evaluate((node) => node.replaceChildren());
}

async function openTrash(page) {
  await page.locator('[data-nav="lixeira"]').click();
  await expect(page.getByRole('heading', { name: 'Lixeira', exact: true })).toBeVisible();
}

async function trashFromTree(page, selector) {
  await page.locator(selector).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mover para a lixeira' }).click();
}

test('excluir, restaurar, conflito, confirmação, busca e reinício', async () => {
  test.setTimeout(180000);
  const { root, longName } = library();
  const { app, page, userData } = await launch(root, 'light');

  await openTrash(page);
  await expect(page.getByRole('heading', { name: 'A lixeira está vazia' })).toBeVisible();
  await expect(page.locator('#lixeira-esvaziar')).toBeDisabled();
  await page.screenshot({ path: path.join(shots, 'lixeira-vazia-claro.png') });
  await page.locator('#tema').click();
  await page.screenshot({ path: path.join(shots, 'lixeira-vazia-escuro.png') });
  await page.locator('#tema').click();

  await page.locator('#arvore [data-open="Estudos/Leitura.md"]').click();
  await expect(page.locator('[data-tab="Estudos/Leitura.md"]')).toBeVisible();
  await trashFromTree(page, '#arvore [data-open="Estudos/Leitura.md"]');
  await expect(page.locator('#arvore [data-open="Estudos/Leitura.md"]')).toHaveCount(0);
  await expect(page.locator('[data-tab="Estudos/Leitura.md"]')).toHaveCount(0);
  await expect(page.locator('.toast').last()).toContainText('Movido para a lixeira.');
  await page.locator('.toast').last().getByRole('button', { name: 'Desfazer' }).click();
  await expect(page.locator('#arvore [data-open="Estudos/Leitura.md"]')).toBeVisible();

  await trashFromTree(page, '#arvore [data-open="Estudos/Ação & café.md"]');
  await trashFromTree(page, '#arvore [data-open="Solta.md"]');
  await trashFromTree(page, `#arvore [data-open="Estudos/${longName}"]`);
  await openTrash(page);
  await expect(page.getByRole('option', { name: /Ação & café/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Solta/ })).toContainText('Solta.md');
  const longRow = page.locator('.lixeira__caminho', { hasText: longName });
  await expect(longRow).toHaveAttribute('title', `Estudos/${longName}`);
  await clearToasts(page);
  await page.screenshot({ path: path.join(shots, 'lixeira-lista-claro.png') });

  await page.getByLabel('Buscar na lixeira').fill('café');
  await expect(page.getByRole('option', { name: /café/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Solta/ })).toHaveCount(0);
  await clearToasts(page);
  await page.screenshot({ path: path.join(shots, 'lixeira-busca-claro.png') });
  await page.getByRole('button', { name: 'Filtrar pastas' }).click();
  await expect(page.getByRole('heading', { name: 'Nenhum item com esse filtro' })).toBeVisible();
  await clearToasts(page);
  await page.screenshot({ path: path.join(shots, 'lixeira-filtro-claro.png') });
  await page.getByRole('button', { name: 'Limpar filtro' }).click();
  await expect(page.getByRole('option', { name: /Solta/ })).toBeVisible();

  await page.getByRole('button', { name: 'Restaurar Solta' }).click();
  await expect(page.locator('.toast').last()).toContainText('Restaurado em Solta.md');
  await page.locator('.toast').last().getByRole('button', { name: 'Abrir' }).click();
  await expect(page.locator('[data-tab="Solta.md"]')).toBeVisible();
  await expect(page.locator('#arvore [data-open="Solta.md"]')).toBeVisible();

  await trashFromTree(page, '#arvore [data-open="Estudos/Conflito.md"]');
  writeNote(root, 'Estudos/Conflito.md', '# Outra\n');
  await openTrash(page);
  await page.getByRole('button', { name: 'Restaurar Conflito' }).click();
  await expect(page.locator('.toast').last()).toContainText('(restaurado)');
  await expect(page.locator('.toast').last()).toContainText('Estudos/Conflito (restaurado).md');
  expect(fs.existsSync(path.join(root, 'Estudos', 'Conflito.md'))).toBe(true);
  expect(fs.existsSync(path.join(root, 'Estudos', 'Conflito (restaurado).md'))).toBe(true);

  await trashFromTree(page, '#arvore [data-open="Sumiu/Dentro.md"]');
  fs.rmSync(path.join(root, 'Sumiu'), { recursive: true, force: true });
  await openTrash(page);
  await page.getByRole('button', { name: 'Restaurar Dentro' }).click();
  await expect(page.locator('.toast').last()).toContainText('Sumiu/Dentro.md');
  expect(fs.existsSync(path.join(root, 'Sumiu', 'Dentro.md'))).toBe(true);

  await page.locator('#arvore [data-open="Solta.md"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Excluir permanentemente/ }).click();
  const permanent = page.getByRole('dialog', { name: 'Excluir permanentemente' });
  await expect(permanent).toBeVisible();
  await expect(permanent.locator('.btn--perigo')).toBeVisible();
  await expect(permanent.locator('#confirma-nao')).toBeFocused();
  await clearToasts(page);
  await page.screenshot({ path: path.join(shots, 'lixeira-confirmar-claro.png') });
  await page.keyboard.press('Escape');
  await expect(permanent).toBeHidden();
  expect(fs.existsSync(path.join(root, 'Solta.md'))).toBe(true);

  await page.locator('#arvore [data-open="Solta.md"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Excluir permanentemente/ }).click();
  await permanent.getByRole('button', { name: 'Excluir permanentemente' }).click();
  await expect(page.locator('#arvore [data-open="Solta.md"]')).toHaveCount(0);
  await expect(page.locator('[data-tab="Solta.md"]')).toHaveCount(0);
  expect(fs.existsSync(path.join(root, 'Solta.md'))).toBe(false);
  await openTrash(page);
  await expect(page.getByRole('option', { name: /Solta/ })).toHaveCount(0);

  await trashFromTree(page, '#arvore [data-open="Estudos/Leitura.md"]');
  await openTrash(page);
  await page.locator('#lixeira-lista').focus();
  const before = await page.locator('.lixeira__item[aria-selected="true"]').getAttribute('data-id');
  await page.keyboard.press('ArrowDown');
  const after = await page.locator('.lixeira__item[aria-selected="true"]').getAttribute('data-id');
  expect(after).not.toBe(before);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.lixeira__item[aria-selected="true"]')).toHaveAttribute(
    'data-id',
    before,
  );
  await page.keyboard.press('Delete');
  const purge = page.getByRole('dialog', { name: 'Excluir de vez' });
  await expect(purge).toBeVisible();
  await expect(purge.locator('#confirma-nao')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(purge).toBeHidden();
  await expect(page.getByRole('option', { name: /Leitura/ })).toBeVisible();

  await page.getByRole('button', { name: 'Esvaziar lixeira', exact: true }).click();
  const emptyDialog = page.getByRole('dialog', { name: 'Esvaziar lixeira' });
  await expect(emptyDialog).toBeVisible();
  await expect(emptyDialog.locator('.btn--perigo')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(emptyDialog).toBeHidden();
  await expect(page.getByRole('option').first()).toBeVisible();

  await app.close();

  const again = await electron.launch({
    args: ['.', `--test-user-data=${userData}`, `--biblioteca=${root}`, '--theme=dark'],
    env: env(),
  });
  const dark = await again.firstWindow();
  await expect(dark.locator('#arvore [data-open="Estudos/Leitura.md"]')).toHaveCount(0);
  await openTrash(dark);
  await expect(dark.getByRole('option', { name: /Leitura/ })).toBeVisible();
  await clearToasts(dark);
  await dark.screenshot({ path: path.join(shots, 'lixeira-lista-escuro.png') });
  await dark.getByLabel('Buscar na lixeira').fill('leitura');
  await dark.screenshot({ path: path.join(shots, 'lixeira-busca-escuro.png') });
  await dark.getByRole('button', { name: 'Filtrar pastas' }).click();
  await dark.screenshot({ path: path.join(shots, 'lixeira-filtro-escuro.png') });
  await dark.getByRole('button', { name: 'Limpar filtro' }).click();
  await dark.getByRole('button', { name: 'Esvaziar lixeira', exact: true }).click();
  await clearToasts(dark);
  await dark.screenshot({ path: path.join(shots, 'lixeira-confirmar-escuro.png') });
  await dark.keyboard.press('Escape');
  await dark.getByRole('button', { name: 'Esvaziar lixeira', exact: true }).click();
  await dark
    .getByRole('dialog', { name: 'Esvaziar lixeira' })
    .getByRole('button', { name: 'Esvaziar lixeira' })
    .click();
  await expect(dark.getByRole('heading', { name: 'A lixeira está vazia' })).toBeVisible();
  expect(fs.existsSync(path.join(root, 'Estudos', 'Leitura.md'))).toBe(false);
  await again.close();
});

test('lixeira com centenas de itens permanece fluida', async () => {
  test.setTimeout(120000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-lixeira-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  writeNote(root, 'Estudos/Fica.md', '# Fica\n');
  const trash = path.join(root, '.sophy', 'lixeira');
  fs.mkdirSync(trash, { recursive: true });
  const total = 180;
  for (let index = 0; index < total; index += 1) {
    const id = `${String(1700000000000 + index)}-${index.toString(16).padStart(8, '0')}`;
    const kind = ['note', 'canvas', 'attachment', 'folder'][index % 4];
    const title = index % 17 === 0 ? `Ação ${index}` : `Item ${index}`;
    const name =
      kind === 'note'
        ? `${title}.md`
        : kind === 'canvas'
          ? `${title}.canvas`
          : kind === 'folder'
            ? title
            : `${title}.png`;
    const dir = path.join(trash, id);
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, '.meta.json'),
      `${JSON.stringify({
        id,
        originalPath: `Estudos/${name}`,
        title,
        kind,
        deletedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        size: 128 + index,
      })}\n`,
    );
    fs.writeFileSync(path.join(dir, name), 'x');
  }
  const { app, page } = await launch(root, 'light');
  await openTrash(page);
  await expect(page.locator('.lixeira__item')).toHaveCount(total);
  const list = page.locator('#lixeira-lista');
  const metrics = await list.evaluate((el) => ({
    scroll: el.scrollHeight,
    client: el.clientHeight,
  }));
  expect(metrics.scroll).toBeGreaterThan(metrics.client);
  await list.focus();
  await page.keyboard.press('End');
  await expect(page.locator('.lixeira__item[aria-selected="true"]')).toContainText('Ação 0');
  await expect(page.locator('.lixeira__item[aria-selected="true"]')).toBeInViewport();
  await page.screenshot({ path: path.join(shots, 'lixeira-muitos-claro.png') });
  await page.locator('#tema').click();
  await page.screenshot({ path: path.join(shots, 'lixeira-muitos-escuro.png') });
  await page.locator('#lixeira-lista').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.toast').last()).toContainText('Restaurado em');
  await app.close();
});

test('carregar e falhar a leitura da lixeira', async () => {
  test.setTimeout(120000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-lixeira-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  writeNote(root, 'Estudos/Nota.md', '# Nota\n');
  fs.writeFileSync(path.join(root, '.sophy', 'lixeira'), 'nao-e-pasta');
  const { app, page } = await launch(root, 'light');
  await page.evaluate(() => {
    window.__sophyTrashDelay = 3000;
  });
  await page.locator('[data-nav="lixeira"]').click();
  await expect(page.getByText('Carregando a lixeira…')).toBeVisible();
  await page.screenshot({ path: path.join(shots, 'lixeira-carregando-claro.png') });
  await page.locator('#tema').click();
  await page.screenshot({ path: path.join(shots, 'lixeira-carregando-escuro.png') });
  await page.evaluate(() => {
    window.__sophyTrashDelay = 0;
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  await page.screenshot({ path: path.join(shots, 'lixeira-erro-escuro.png') });
  await page.locator('#tema').click();
  await page.screenshot({ path: path.join(shots, 'lixeira-erro-claro.png') });
  await page.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  fs.rmSync(path.join(root, '.sophy', 'lixeira'));
  await page.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(page.getByRole('heading', { name: 'A lixeira está vazia' })).toBeVisible();
  await app.close();
});

test('a paleta abre a lixeira', async () => {
  test.setTimeout(60000);
  const { root } = library();
  const { app, page } = await launch(root);
  await page.keyboard.press('Control+Shift+P');
  await page.locator('#comando-q').fill('Lixeira');
  await page.locator('#comando-lista .menu__item', { hasText: 'Lixeira' }).click();
  await expect(page.getByRole('heading', { name: 'Lixeira', exact: true })).toBeVisible();
  await expect(page.locator('[data-nav="lixeira"]')).toHaveAttribute('aria-current', 'page');
  await app.close();
});
