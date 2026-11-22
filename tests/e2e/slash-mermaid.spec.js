const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const shots = path.join('/workspace', 'slash-mermaid-prints');

function launchWith(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-slash-mmd-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  for (const [name, text] of Object.entries(files))
    fs.writeFileSync(path.join(root, 'Estudos', name), text);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-slash-mmd-data-'));
  fs.writeFileSync(
    path.join(userData, 'ui.json'),
    JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme: 'light' }),
  );
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  return electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
}

test('o menu / insere um diagrama Mermaid e desenha', async () => {
  const app = await launchWith({ 'Rascunho.md': '# Rascunho\n\nEscreva aqui.\n' });
  const page = await app.firstWindow();
  fs.mkdirSync(shots, { recursive: true });
  try {
    await page.locator('#arvore').getByText('Rascunho', { exact: true }).first().click();
    const block = page.locator('.bloco--texto').first();
    await expect(block).toBeVisible();
    await block.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('/merm');
    const menu = page.locator('.menu--blocos');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('option', { name: 'Diagrama (Mermaid)' })).toBeVisible();
    await expect(menu).toContainText('Sequência');
    await menu.screenshot({ path: path.join(shots, 'menu.png') });
    await page.screenshot({ path: '/workspace/slash-mermaid-menu.png' });

    await menu.getByRole('option', { name: 'Diagrama (Mermaid)' }).click();
    const wrap = page.locator('.codigo--mermaid');
    await expect(wrap).toBeVisible();
    await expect(wrap.locator('.codigo__diagrama svg')).toBeVisible({ timeout: 20000 });
    await expect(wrap.locator('.codigo__diagrama')).toContainText('Início');
    await expect(wrap.locator('.codigo__diagrama')).toContainText('Próximo passo');
    await wrap.screenshot({ path: path.join(shots, 'diagrama.png') });
    await page.screenshot({ path: '/workspace/slash-mermaid-diagrama.png' });
  } finally {
    await app.close();
  }
});
