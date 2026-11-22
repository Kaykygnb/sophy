const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4tt-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Estudos', 'Leitura.md'), '# Leitura\n\nTexto com #estudo no meio, `#codigo` e #memoria.\n\nFim:\n');
  fs.writeFileSync(path.join(root, 'Estudos', 'Plano.md'), '# Plano\n\nOutro #estudo aqui.\n');
  fs.writeFileSync(path.join(root, 'Estudos', 'Solta.md'), '# Solta\n\nSem tags, só memória.\n');
  return root;
}

async function launch(root) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4tt-data-'));
  fs.writeFileSync(path.join(userData, 'ui.json'), JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme: 'light' }));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
  return { app, page: await app.firstWindow() };
}

test('tags no texto: #tag colorida e clicável, autocomplete de # e filtro de tag na busca', async () => {
  const root = library();
  const { app, page } = await launch(root);
  try {
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().click();
    await expect(page.locator('.bloco').first()).toBeVisible();
    const supported = await page.evaluate(async () => (await sophy.tool('tag.suggest', {})).code !== 'not-found');

    // colorida: duas tags no texto, e o código inline não vira tag
    const chips = page.locator('#coluna .tag-inline');
    await expect(chips).toHaveCount(2);
    await expect(chips.first()).toHaveText('#estudo');
    const hue = await chips.first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(hue).not.toBe('rgba(0, 0, 0, 0)');
    // o texto salvo continua sendo markdown puro
    const para = page.locator('.bloco').nth(1);
    const box = await para.boundingBox();
    await para.click({ position: { x: box.width - 8, y: box.height / 2 } });
    await page.keyboard.press('End');
    await page.keyboard.type(' x');
    await expect.poll(() => fs.readFileSync(path.join(root, 'Estudos', 'Leitura.md'), 'utf8')).toContain('#estudo no meio, `#codigo` e #memoria. x');

    test.skip(!supported, 'precisa do PR 34 (tag.suggest)');
    // autocomplete ao digitar #
    const last = page.locator('.bloco').last();
    await last.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' #me');
    const menu = page.locator('.menu--tags');
    await expect(menu).toContainText('memoria');
    await page.keyboard.press('Enter');
    await expect.poll(() => fs.readFileSync(path.join(root, 'Estudos', 'Leitura.md'), 'utf8')).toMatch(/#memoria\s*$/m);

    // clique na tag abre a tela da tag
    await page.locator('#arvore').getByText('Plano', { exact: true }).first().click();
    await page.locator('#coluna .tag-inline').first().click();
    await expect(page.locator('.tag-selo')).toHaveText('#estudo');
    await expect(page.locator('.etiqueta-nota')).toHaveCount(2);

    // busca com filtro de tag
    await page.keyboard.press('Control+k');
    await page.locator('#paleta-q').fill('#estudo');
    await expect(page.locator('#paleta-filtro-tag')).toContainText('#estudo');
    await expect(page.locator('#paleta-lista [data-hit]')).toHaveCount(2);
    await page.locator('#paleta-q').fill('#estudo mem');
    await expect(page.locator('#paleta-lista [data-hit]')).toHaveCount(1);
  } finally {
    await app.close();
  }
});
