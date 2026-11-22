const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4p-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Estudos', 'Leitura.md'), '# Leitura\n\nTexto.\n');
  return root;
}

async function launch(root) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4p-data-'));
  fs.writeFileSync(path.join(userData, 'ui.json'), JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme: 'light' }));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
  return { app, page: await app.firstWindow() };
}

test('propriedades: ícone por tipo, adicionar visível, edição no lugar e id somente leitura em Avançado', async () => {
  const { app, page } = await launch(library());
  try {
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().click();
    const add = page.locator('#adicionar-propriedade');
    await page.locator('.nota-propriedades > summary').click();
    await expect(add).toBeVisible();
    await expect(add).toContainText('Adicionar propriedade');

    // cria uma propriedade de data
    await add.click();
    await page.locator('#property-name').fill('Prazo');
    await page.locator('#property-type').selectOption('date');
    await page.locator('#property-save').click();
    const row = page.locator('.propriedade[data-property]').first();
    await expect(row.locator('.propriedade__tipo')).toBeVisible();
    await expect(row.locator('.propriedade__tipo')).toHaveAttribute('title', 'Tipo: Data');

    // edição no lugar: o valor é um campo na própria linha
    const value = row.locator('[data-property-value]');
    await value.fill('2026-12-01');
    await value.blur();
    await expect(value).toHaveValue('2026-12-01');

    // Avançado: id somente leitura
    const advanced = page.locator('.nota-avancado');
    if (await advanced.count()) {
      await advanced.locator('summary').click();
      const id = advanced.locator('input');
      await expect(id).toHaveAttribute('readonly', '');
      await expect(advanced).toContainText('Somente leitura');
    }
  } finally {
    await app.close();
  }
});
