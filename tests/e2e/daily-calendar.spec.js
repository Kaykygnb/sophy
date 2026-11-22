const { test, expect, _electron: electron } = require('@playwright/test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bin = path.resolve('engine/cli.ts');

function makeLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-diario-ui-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Diário'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Diário', '2026-11-21.md'),
    '---\ndata: 1999-01-01\n---\n# Ignorado\n\nO almoço custou R$ 32.\n',
  );
  for (let index = 0; index < 4; index += 1) {
    fs.writeFileSync(
      path.join(root, 'Estudos', `Nota${index}.md`),
      '---\ndata: 2026-11-21\n---\n# Nota\n',
    );
  }
  return root;
}

async function launch(root, env = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-diario-data-'));
  const merged = { ...process.env, NODE_OPTIONS: '--experimental-strip-types', ...env };
  delete merged.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ['.', `--test-user-data=${userData}`, `--biblioteca=${root}`, '--theme=light'],
    env: merged,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { app, page, errors };
}

test('nota do dia travada, grade e painel', async () => {
  const root = makeLibrary();
  const { app, page, errors } = await launch(root);
  try {
    await page.locator('#arvore').getByRole('button', { name: '2026-11-21', exact: true }).click();
    const title = page.locator('.nota-dia__titulo');
    await expect(title).toBeVisible();
    await expect(title).toContainText('Sábado, 21 de novembro de 2026');
    await expect(title).not.toHaveAttribute('contenteditable', 'true');
    await expect(title.locator('use')).toHaveAttribute('href', '#i-cadeado');
    await expect(page.locator('.propriedade--travada input')).toHaveValue('2026-11-21');
    await expect(page.locator('.coluna')).toContainText('R$ 32');

    await page.locator('#nota-mais').click();
    await expect(page.locator('.nota-menu')).toBeVisible();
    await expect(page.locator('.nota-menu')).not.toContainText('Renomear');
    await expect(page.locator('.nota-menu')).not.toContainText('Mover');
    await expect(page.locator('.nota-menu')).not.toContainText('Mudar data');
    await page.keyboard.press('Escape');

    await page.locator('#arvore').getByRole('button', { name: '2026-11-21', exact: true }).click({ button: 'right' });
    const menu = page.locator('.menu[role="menu"]');
    await expect(menu).toBeVisible();
    await expect(menu).not.toContainText('Renomear');
    await expect(menu).not.toContainText('Mover');
    await expect(menu.getByRole('menuitem', { name: 'Excluir…' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.keyboard.press('F2');
    await expect(page.locator('.toast')).toContainText('Notas do dia têm o nome fixo pela data');

    await page.evaluate(() => handleTreeNoteDrop('Diário/2026-11-21.md', { type: 'shelf', shelf: 'Estudos' }));
    await expect(page.locator('.toast').last()).toContainText('Notas do dia têm o nome fixo pela data');
    expect(fs.existsSync(path.join(root, 'Diário', '2026-11-21.md'))).toBe(true);

    await page.locator('[data-nav="calendario"]').click();
    const today = page.locator('.cal-dia.is-hoje');
    const marked = page.locator('.cal-dia[data-date="2026-11-21"]');
    await expect(today).toBeVisible();
    await expect(marked.locator('.cal-ponto')).toHaveCount(3);
    await expect(marked.locator('.cal-mais')).toHaveText('+2');
    await expect(marked).toHaveClass(/is-nota/);
    await expect(page.locator('.cal-item')).toHaveCount(0);
    await expect(page.locator('.cal-semana span')).toHaveText(['S', 'T', 'Q', 'Q', 'S', 'S', 'D']);

    const before = await today.getAttribute('data-date');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.cal-dia[aria-selected="true"]')).toHaveAttribute('data-date', '2026-11-21');
    await page.keyboard.press('Enter');
    await expect(page.locator('.painel-dia')).toBeVisible();
    await expect(page.locator('.painel-dia')).toContainText('Sábado, 21 de novembro de 2026');
    await page.keyboard.press('t');
    await expect(page.locator('.cal-dia[aria-selected="true"]')).toHaveAttribute('data-date', before);
    await page.keyboard.press('Escape');
    await expect(page.locator('.painel-dia')).toHaveCount(0);

    await page.locator('.cal-dia[data-date="2026-11-01"]').click();
    await expect(page.locator('#criar-nota-dia')).toHaveText('Criar nota do dia');
    await page.locator('#fechar-dia').click();
    await expect(page.locator('.painel-dia')).toHaveCount(0);

    await page.locator('#tema').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    await expect(page.locator('.calendario')).toBeVisible();
    await expect(today).toBeVisible();
    await page.locator('#tema').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('diálogo de conflito chama merge e asNote', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-restore-ui-'));
  const trashHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-restore-trash-'));
  fs.mkdirSync(path.join(root, 'Diário'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Diário', '2026-11-21.md'), 'velha\n');
  const { app, page } = await launch(root, { XDG_DATA_HOME: trashHome });
  try {
    const env = { ...process.env, XDG_DATA_HOME: trashHome };
    delete env.SOPHY_LIBRARY;
    delete env.ELECTRON_RUN_AS_NODE;
    const removed = spawnSync(
      process.execPath,
      ['--experimental-strip-types', bin, 'lixeira', 'Diário/2026-11-21.md', '--json', '--biblioteca', root],
      { encoding: 'utf8', env, cwd: os.tmpdir() },
    );
    expect(removed.status, removed.stderr).toBe(0);
    const id = path.basename(JSON.parse(removed.stdout).trashPath);
    await page.evaluate(async () => {
      await tool('note.create', { path: 'Diário/2026-11-21.md', body: 'nova\n' });
    });
    const pending = page.evaluate((trashId) => restoreTrashed(trashId), id);
    await page.getByRole('button', { name: 'Juntar conteúdo' }).click();
    await pending;
    const merged = fs.readFileSync(path.join(root, 'Diário', '2026-11-21.md'), 'utf8');
    expect(merged).toContain('nova');
    expect(merged).toContain('velha');

    const again = spawnSync(
      process.execPath,
      ['--experimental-strip-types', bin, 'lixeira', 'Diário/2026-11-21.md', '--json', '--biblioteca', root],
      { encoding: 'utf8', env, cwd: os.tmpdir() },
    );
    expect(again.status, again.stderr).toBe(0);
    const second = path.basename(JSON.parse(again.stdout).trashPath);
    await page.evaluate(async () => {
      await tool('note.create', { path: 'Diário/2026-11-21.md', body: 'ocupado\n' });
    });
    const other = page.evaluate((trashId) => restoreTrashed(trashId), second);
    await page.getByRole('button', { name: 'Restaurar como nota comum' }).click();
    const restored = await other;
    expect(restored.path).toMatch(/ \(restaurado\)\.md$/);
    expect(fs.readFileSync(path.join(root, ...restored.path.split('/')), 'utf8')).toContain('nova');
    expect(fs.readFileSync(path.join(root, 'Diário', '2026-11-21.md'), 'utf8')).toContain('ocupado');
  } finally {
    await app.close();
  }
});
