const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4t-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Estudos', 'Leitura.md'), '---\ntags: [estudo]\n---\n# Leitura\n\nTexto com #estudo/leitura no meio.\n');
  fs.writeFileSync(path.join(root, 'Estudos', 'Plano.md'), '# Plano\n\nOutro #estudo e #projeto.\n');
  return root;
}

async function launch(root) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4t-data-'));
  fs.writeFileSync(path.join(userData, 'ui.json'), JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme: 'light' }));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
  return { app, page: await app.firstWindow() };
}

test('tags: painel em árvore com contagem, notas da tag, chips abaixo do título e renomear', async () => {
  const root = library();
  const { app, page } = await launch(root);
  try {
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().waitFor();
    const supported = await page.evaluate(async () => (await sophy.tool('tags.list', {})).code !== 'not-found');
    test.skip(!supported, 'precisa do PR 34 (tags.list)');
    const panel = page.locator('#tags-painel');
    await expect(panel).toBeVisible();
    const estudo = panel.locator('[data-tag="estudo"]');
    await expect(estudo).toContainText('estudo');
    await expect(estudo.locator('.tag-linha__conta')).toHaveText('2');
    await expect(panel.locator('[data-tag="estudo/leitura"]')).toBeVisible();

    // clicar filtra: lista as notas com a tag e as filhas
    await estudo.click();
    await expect(page.locator('.etiqueta-nota')).toHaveCount(2);
    await expect(page.locator('.tag-selo')).toHaveText('#estudo');

    // chips da nota: adicionar e tirar
    await page.locator('#arvore').getByText('Leitura', { exact: true }).first().click();
    // as tags ficam na faixa logo abaixo do título, fora das Propriedades
    await expect(page.locator('#nota-tags')).toBeVisible();
    await expect(page.locator('.tag-chip[data-tag-chip="estudo"]')).toBeVisible();
    await page.locator('#tag-adicionar').click();
    await page.locator('#tag-novo-campo').fill('memoria');
    await page.locator('#tag-novo-campo').press('Enter');
    await expect(page.locator('.tag-chip[data-tag-chip="memoria"]')).toBeVisible();
    await expect.poll(() => fs.readFileSync(path.join(root, 'Estudos', 'Leitura.md'), 'utf8')).toContain('memoria');
    await page.locator('[data-tag-tirar="memoria"]').click();
    await expect(page.locator('.tag-chip[data-tag-chip="memoria"]')).toHaveCount(0);

    // renomear pelo menu da tag
    await panel.locator('.tag-linha', { has: page.locator('[data-tag="projeto"]') }).hover();
    await panel.locator('[data-tag-menu="projeto"]').click();
    await page.getByRole('menuitem', { name: /Renomear tag/ }).click();
    await page.locator('#dialogo-texto input').fill('trabalho');
    await page.locator('#dialogo-texto').getByRole('button', { name: 'Renomear' }).click();
    await expect(panel.locator('[data-tag="trabalho"]')).toBeVisible();
    await expect(panel.locator('[data-tag="projeto"]')).toHaveCount(0);
    expect(fs.readFileSync(path.join(root, 'Estudos', 'Plano.md'), 'utf8')).toContain('#trabalho');
  } finally {
    await app.close();
  }
});
