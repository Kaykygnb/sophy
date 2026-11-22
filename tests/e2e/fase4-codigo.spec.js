const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('bloco de código: nome no cabeçalho vai para a cerca e a linguagem continua', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4c-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  const file = path.join(root, 'Estudos', 'Leitura.md');
  fs.writeFileSync(file, '# Leitura\n\n```js\nconst a = 1;\n```\n');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4c-data-'));
  fs.writeFileSync(path.join(userData, 'ui.json'), JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme: 'light' }));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
  const page = await app.firstWindow();
  try {
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().click();
    const name = page.locator('[data-code-name]');
    await expect(name).toBeVisible();
    await expect(name).toHaveAttribute('placeholder', 'Nome do bloco');
    await name.fill('parser-de-cartoes.js');
    await name.press('Enter');
    await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 8000 }).toContain('```js title="parser-de-cartoes.js"');
    await expect(page.locator('.codigo__lingua-nome')).toHaveText('JavaScript');

    // reabrir mantém o nome
    await page.locator('[data-nav="inicio"]').click();
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().click();
    await expect(page.locator('[data-code-name]')).toHaveValue('parser-de-cartoes.js');

    // limpar o nome volta à cerca simples
    await page.locator('[data-code-name]').fill('');
    await page.locator('[data-code-name]').press('Enter');
    await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 8000 }).toContain('```js\n');
  } finally {
    await app.close();
  }
});
