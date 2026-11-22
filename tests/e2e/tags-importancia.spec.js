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

const toneOf = (locator) =>
  locator.evaluate((el) => {
    const specified = getComputedStyle(el).getPropertyValue('--tag-tom').trim();
    const probe = document.createElement('span');
    probe.style.color = specified || 'currentColor';
    el.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });

const tagsJson = (root) => {
  const file = path.join(root, '.sophy', 'tags.json');
  if (!fs.existsSync(file)) return { cores: {} };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

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
    expect(await toneOf(livro.locator('xpath=..'))).toMatch(/^rgb/);
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
    const title = await page.locator('.coluna h1').first().boundingBox();
    const bandBox = await band.boundingBox();
    expect(bandBox.y).toBeGreaterThan(title.y);
    expect(await toneOf(chip)).toBe(
      await toneOf(page.locator('#tags-painel [data-tag="estudo"]').locator('xpath=..')),
    );
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
    await band.locator('.tag-chip[data-tag-chip="estudo"]').locator('.tag-chip__nome').click();
    await expect(page.locator('.etiqueta-capa .tag-selo')).toHaveText('#estudo');
  } finally {
    await app.close();
  }
});

test('tags: tela da tag com números, filhas, aparece junto com, cor no motor e renomear', async () => {
  const { app, page, root } = await open('dark');
  try {
    await page.locator('#tags-painel [data-tag="estudo"]').click();
    const capa = page.locator('.etiqueta-capa');
    await expect(capa.locator('.tag-selo')).toHaveText('#estudo');
    await expect(capa.locator('.etiqueta-capa__numeros')).toContainText('notas');
    await expect(
      page.locator('.etiqueta-secao', { has: page.locator('h3', { hasText: 'Tags filhas' }) }),
    ).toContainText('#estudo/memoria');
    const juntas = page.locator('#tag-juntas');
    await expect(juntas.locator('h3')).toHaveText('Aparece junto com');
    await expect(juntas.locator('[data-tag-ir="metodo"]')).toBeVisible();
    await expect(juntas.locator('[data-tag-ir="metodo"] .tag-inline__juntas')).toHaveText('3');
    await expect(
      page.locator('.etiqueta-secao', {
        has: page.locator('h3', { hasText: 'Notas relacionadas' }),
      }),
    ).toBeVisible();
    expect(await page.locator('.etiqueta-nota').count()).toBeGreaterThan(4);

    await page.locator('#tag-cor').click();
    await expect(page.locator('#tag-cores')).toBeVisible();
    await expect(page.locator('#tag-cores [data-tag-cor="azul"]')).toBeVisible();
    await expect(page.locator('#tag-cor-hex')).toBeVisible();
    await expect(page.locator('#tag-sem-cor')).toHaveText('Sem cor');
    await page.locator('#tag-cores [data-tag-cor="azul"]').click();
    await expect(page.locator('#tag-cores [data-tag-cor="azul"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect
      .poll(() => tagsJson(root).cores?.estudo)
      .toBe('azul');
    const after = await toneOf(page.locator('#tags-painel [data-tag="estudo"]').locator('xpath=..'));
    expect(after).toBe(await toneOf(page.locator('.etiqueta-tela')));
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).some((key) => key.startsWith('sophy-tag-cores:')),
      ),
    ).toBe(false);

    await page.locator('#tag-juntas [data-tag-ir="livro"]').click();
    await expect(page.locator('.etiqueta-capa .tag-selo')).toHaveText('#livro');
    await page.locator('#tags-painel [data-tag="estudo"]').click();
    await expect(page.locator('.etiqueta-capa .tag-selo')).toHaveText('#estudo');

    await page.locator('#tag-renomear').click();
    await page.locator('#dialogo-texto input').fill('aprendizado');
    await page.locator('#dialogo-texto').getByRole('button', { name: 'Renomear' }).click();
    await expect(page.locator('#tags-painel [data-tag="aprendizado"]')).toBeVisible();
    await expect(page.locator('#tags-painel [data-tag="estudo"]')).toHaveCount(0);
    expect(fs.readFileSync(path.join(root, 'Estudos', 'Foco.md'), 'utf8')).toContain('aprendizado');
    await expect
      .poll(() => tagsJson(root).cores?.aprendizado)
      .toBe('azul');
    expect(tagsJson(root).cores?.estudo).toBeUndefined();
    expect(await toneOf(page.locator('#tags-painel [data-tag="aprendizado"]').locator('xpath=..'))).toBe(
      after,
    );

    await page.locator('#tag-grafo').click();
    await expect(page.locator('#grafo-canvas')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('tags: remover a cor, migrar o localStorage e cor livre #rrggbb', async () => {
  const { app, page, root } = await open();
  try {
    const storageKey = `sophy-tag-cores:${root}`;
    await page.evaluate((key) => {
      localStorage.setItem(key, JSON.stringify({ estudo: 212, livro: 'rosa' }));
    }, storageKey);
    await page.reload();
    await expect(page.locator('#tags-painel .tags-painel__topo')).toBeVisible();
    await expect.poll(() => tagsJson(root).cores?.livro).toBe('rosa');
    await expect.poll(() => tagsJson(root).cores?.estudo).toMatch(/^#[0-9a-f]{6}$/);
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
    const livroTone = await toneOf(page.locator('#tags-painel [data-tag="livro"]').locator('xpath=..'));
    expect(livroTone).toMatch(/^rgb/);

    await page.locator('#tags-painel [data-tag="livro"]').click();
    await expect(page.locator('.etiqueta-capa .tag-selo')).toHaveText('#livro');
    await page.locator('#tag-cor').click();
    await expect(page.locator('#tag-cores [data-tag-cor="rosa"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.locator('#tag-sem-cor').click();
    await expect.poll(() => tagsJson(root).cores?.livro).toBeUndefined();
    await expect(page.locator('#tag-sem-cor')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.etiqueta-capa .tag-selo')).toHaveText('#livro');
    expect(await toneOf(page.locator('.etiqueta-tela'))).toMatch(/^rgb/);

    await page.locator('#tag-cor-hex').fill('#c45c1a');
    await page.locator('#tag-cor-hex').press('Enter');
    await expect.poll(() => tagsJson(root).cores?.livro).toBe('#c45c1a');
    await expect(page.locator('#tag-cor-hex')).toHaveValue('#c45c1a');
  } finally {
    await app.close();
  }
});
