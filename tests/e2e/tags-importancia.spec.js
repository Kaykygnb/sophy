const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { makeGraphLibrary, launchArgs, NOTAS } = require('./grafo-biblioteca.js');

async function open(theme = 'light') {
  const root = makeGraphLibrary('sophy-tags-');
  const app = await electron.launch(launchArgs(root, theme));
  const page = await app.firstWindow();
  await expect(page.locator('#tags-painel .tags-painel__topo')).toBeVisible();
  return { app, page, root };
}

const hueOf = (locator) =>
  locator.evaluate((el) => getComputedStyle(el).getPropertyValue('--tag-h').trim());

test('tags: seção na lateral com cor e contagem, acima da árvore', async () => {
  const { app, page } = await open();
  try {
    const panel = page.locator('#tags-painel');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    const tree = await page.locator('#arvore').boundingBox();
    expect(box.y).toBeLessThan(tree.y);
    const livro = panel.locator('[data-tag="livro"]');
    await expect(livro.locator('.tag-linha__conta')).toHaveText(
      String(NOTAS.filter((nota) => nota[4].includes('livro')).length),
    );
    await expect(livro.locator('.tag-ponto')).toBeVisible();
    expect(await hueOf(livro)).not.toBe('');
    // filha aparece na árvore de tags
    await expect(panel.locator('[data-tag="estudo/memoria"]')).toBeAttached();
    await livro.click();
    await expect(page.locator('.etiqueta-capa .tag-selo')).toHaveText('#livro');
  } finally {
    await app.close();
  }
});

test('tags: faixa de chips na nota, cores iguais às da lateral e + com sugestões', async () => {
  const { app, page, root } = await open();
  try {
    await page.locator('#arvore').getByText('Memoria', { exact: true }).first().click();
    const band = page.locator('#nota-tags');
    await expect(band).toBeVisible();
    const chip = band.locator('.tag-chip[data-tag-chip="estudo"]');
    await expect(chip).toBeVisible();
    // a faixa fica logo abaixo do título
    const title = await page.locator('.coluna h1').first().boundingBox();
    const bandBox = await band.boundingBox();
    expect(bandBox.y).toBeGreaterThan(title.y);
    expect(await hueOf(chip)).toBe(
      await hueOf(page.locator('#tags-painel [data-tag="estudo"]').locator('xpath=..')),
    );
    // + Tag com autocomplete do motor
    await page.locator('#tag-adicionar').click();
    await page.locator('#tag-novo-campo').fill('ide');
    const list = page.locator('#tag-sugestoes');
    await expect(list).toContainText('ideia');
    await page.locator('#tag-novo-campo').press('ArrowDown');
    await page.locator('#tag-novo-campo').press('Enter');
    await expect(band.locator('.tag-chip[data-tag-chip="ideia"]')).toBeVisible();
    await expect
      .poll(() => fs.readFileSync(path.join(root, 'Estudos', 'Memoria.md'), 'utf8'))
      .toMatch(/tags:.*ideia/s);
    // clicar no chip abre a tela da tag
    await band.locator('.tag-chip[data-tag-chip="estudo"]').locator('.tag-chip__nome').click();
    await expect(page.locator('.etiqueta-capa .tag-selo')).toHaveText('#estudo');
  } finally {
    await app.close();
  }
});

test('tags: tela da tag com números, filhas, relacionadas, cor e renomear', async () => {
  const { app, page, root } = await open('dark');
  try {
    await page.locator('#tags-painel [data-tag="estudo"]').click();
    const capa = page.locator('.etiqueta-capa');
    await expect(capa.locator('.tag-selo')).toHaveText('#estudo');
    await expect(capa.locator('.etiqueta-capa__numeros')).toContainText('notas');
    await expect(
      page.locator('.etiqueta-secao', { has: page.locator('h3', { hasText: 'Tags filhas' }) }),
    ).toContainText('#estudo/memoria');
    await expect(
      page.locator('.etiqueta-secao', {
        has: page.locator('h3', { hasText: 'Aparece junto com' }),
      }),
    ).toBeVisible();
    await expect(
      page.locator('.etiqueta-secao', {
        has: page.locator('h3', { hasText: 'Notas relacionadas' }),
      }),
    ).toBeVisible();
    expect(await page.locator('.etiqueta-nota').count()).toBeGreaterThan(4);
    // mudar a cor muda em todo lugar e fica salva
    await page.locator('#tag-cor').click();
    await expect(page.locator('#tag-cores')).toBeVisible();
    const target = page.locator('#tag-cores [data-tag-cor]').nth(3);
    const hue = await target.getAttribute('data-tag-cor');
    await target.click();
    await expect
      .poll(() => hueOf(page.locator('#tags-painel [data-tag="estudo"]').locator('xpath=..')))
      .toBe(hue);
    await expect.poll(() => hueOf(page.locator('.etiqueta-tela'))).toBe(hue);
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).some(
          (key) =>
            key.startsWith('sophy-tag-cores:') && localStorage.getItem(key).includes('estudo'),
        ),
      ),
    ).toBe(true);
    // renomear pede confirmação e renomeia no disco
    await page.locator('#tag-renomear').click();
    await page.locator('#dialogo-texto input').fill('aprendizado');
    await page.locator('#dialogo-texto').getByRole('button', { name: 'Renomear' }).click();
    await expect(page.locator('#tags-painel [data-tag="aprendizado"]')).toBeVisible();
    await expect(page.locator('#tags-painel [data-tag="estudo"]')).toHaveCount(0);
    expect(fs.readFileSync(path.join(root, 'Estudos', 'Foco.md'), 'utf8')).toContain('aprendizado');
    // ver no grafo
    await page.locator('#tag-grafo').click();
    await expect(page.locator('#grafo-canvas')).toBeVisible();
  } finally {
    await app.close();
  }
});
