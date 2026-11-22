const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sophy-ui-r3-${process.pid}-`));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Estudos', 'A.md'), '# A\n\nTexto.\n');
  fs.writeFileSync(path.join(root, 'Estudos', 'B.md'), '# B\n\nOutra.\n');
  if (process.platform !== 'win32') fs.writeFileSync(path.join(root, 'Estudos', 'nome?.md'), '# Pergunta\n\nInvalida.\n');
  if (process.platform !== 'win32') fs.mkdirSync(path.join(root, `Ab'c"d`));
  if (process.platform !== 'win32') fs.writeFileSync(path.join(root, 'con.md'), '# con\n');
  return root;
}

async function launch(root) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `sophy-ui-data-${process.pid}-`));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ['.', `--test-user-data=${userData}`, `--biblioteca=${root}`, '--theme=light'],
    env,
  });
  const page = await app.firstWindow();
  await page.locator('#arvore [data-open="Estudos/A.md"]').click();
  return { app, page };
}

test('um nome inválido não impede gravar as outras notas e só avisa uma vez', async () => {
  test.skip(process.platform === 'win32', 'Nomes incompatíveis não podem ser criados no Windows.');
  const root = library();
  const { app, page } = await launch(root);
  await expect(page.locator('.toast--erro')).toHaveCount(1);
  await page.locator('.bloco--texto').first().click();
  await page.keyboard.type(' SALVOU');
  await expect.poll(() => fs.readFileSync(path.join(root, 'Estudos', 'A.md'), 'utf8')).toContain('SALVOU');
  await expect(page.locator('.toast--erro')).toHaveCount(1);
  await page.locator('#arvore [data-open="Estudos/nome?.md"]').click();
  await expect(page.locator('.bloco--texto').first()).toContainText('Invalida');
  await page.locator('#arvore [data-open="Estudos/nome?.md"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Renomear' }).click();
  await page.locator('[data-rename="note"]').fill('nome');
  await page.locator('[data-rename="note"]').press('Enter');
  await expect.poll(() => fs.existsSync(path.join(root, 'Estudos', 'nome.md'))).toBe(true);
  await app.close();
});

test('depois do conflito dá para trocar de nota e manter a edição', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('.bloco--texto').first().click();
  await page.keyboard.type(' MINHA');
  await expect.poll(() => fs.readFileSync(path.join(root, 'Estudos', 'A.md'), 'utf8')).toContain('MINHA');
  fs.writeFileSync(path.join(root, 'Estudos', 'A.md'), '# A\n\nTexto. EXTERNO\n');
  await page.keyboard.type(' MAIS');
  await expect(page.locator('.aviso').filter({ hasText: 'mudou desde a leitura' })).toBeVisible();
  await page.locator('#arvore [data-open="Estudos/B.md"]').click();
  await page.getByRole('button', { name: 'Manter', exact: true }).click();
  await expect(page.locator('.bloco--texto').first()).toContainText('Outra');
  const saved = fs.readFileSync(path.join(root, 'Estudos', 'A.md'), 'utf8');
  expect(saved).toContain('MINHA');
  expect(saved).toContain('MAIS');
  await app.close();
});
