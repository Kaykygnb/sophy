const { test, expect, _electron: electron } = require('@playwright/test');
const { makeGraphLibrary, launchArgs, NOTAS } = require('./grafo-biblioteca.js');

const graphApi = (page, fn, arg) =>
  page.evaluate(
    ([source, value]) =>
      new Function('g', 'arg', `return (${source})(g, arg)`)(
        document.querySelector('#grafo-canvas').__sophyGraph,
        value,
      ),
    [fn.toString(), arg],
  );

async function openGraph(theme = 'light') {
  const root = makeGraphLibrary();
  const app = await electron.launch(launchArgs(root, theme));
  const page = await app.firstWindow();
  await page.locator('[data-nav="grafo"]').click();
  await expect(page.locator('#grafo-canvas')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.querySelector('#grafo-canvas')?.__sophyGraph)))
    .toBe(true);
  return { app, page, root };
}

const settled = (page) =>
  expect.poll(() => graphApi(page, (g) => g.settled()), { timeout: 15000 }).toBe(true);

test('grafo: painel visível, notas sem sobreposição depois que a simulação assenta', async () => {
  const { app, page } = await openGraph();
  try {
    const panel = page.locator('#grafo-painel');
    await expect(panel).toBeVisible();
    for (const view of ['notas', 'estantes', 'tags'])
      await expect(panel.locator(`[data-graph-view="${view}"]`)).toBeVisible();
    await expect(page.locator('#grafo-busca')).toBeVisible();
    await expect(page.locator('#grafo-centralizar')).toBeVisible();
    await expect(page.locator('#grafo-de')).toBeVisible();
    await expect(page.locator('#grafo-ate')).toBeVisible();
    await expect(page.locator('#grafo-legenda')).toContainText('Estudos');
    await expect(page.locator('#grafo-contagem')).toContainText(`${NOTAS.length} notas`);
    await settled(page);
    const nodes = await graphApi(page, (g) => g.snapshot());
    expect(nodes.length).toBe(NOTAS.length);
    for (let i = 0; i < nodes.length; i += 1)
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.label} × ${b.label}`).toBeGreaterThanOrEqual(
          a.r + b.r - 0.01,
        );
      }
    // ligação a bloco nomeado aparece com tipo próprio
    const links = await graphApi(page, (g) => g.links());
    expect(links.some((link) => link.kind === 'block')).toBe(true);
    // filtro de estante
    await page.locator('[data-graph-shelf="Leituras"]').click();
    await expect(page.locator('#grafo-contagem')).not.toContainText(`${NOTAS.length} notas`);
    await page.locator('[data-graph-shelf="Leituras"]').click();
    await expect(page.locator('#grafo-contagem')).toContainText(`${NOTAS.length} notas`);
    await page.locator('#grafo-centralizar').click();
  } finally {
    await app.close();
  }
});

test('grafo: linha do tempo toca, mostra a data e faz as notas aparecerem em ordem', async () => {
  const { app, page } = await openGraph();
  try {
    await settled(page);
    await page.locator('[data-graph-speed="4"]').click();
    await expect(page.locator('[data-graph-speed="4"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#grafo-play').click();
    await expect(page.locator('#grafo-play')).toHaveAttribute('aria-label', /Pausar/);
    const clock = page.locator('#grafo-relogio');
    await expect(clock).toBeVisible();
    await expect(page.locator('#grafo-relogio-data')).not.toHaveText('');
    const first = await graphApi(page, (g) => g.timeline);
    expect(first.playing).toBe(true);
    const countAt = async () =>
      Number((await page.locator('#grafo-relogio-conta').textContent()).split(' ')[0]);
    const start = await countAt();
    expect(start).toBeLessThan(NOTAS.length);
    await expect.poll(countAt, { timeout: 15000 }).toBeGreaterThan(start);
    // pausar e mexer na régua de datas
    await page.locator('#grafo-play').click();
    await expect(page.locator('#grafo-play')).toHaveAttribute('aria-label', /Reproduzir/);
    await page.locator('#grafo-tempo').fill('0');
    await expect.poll(countAt).toBeLessThan(4);
    const nodes = await graphApi(page, (g) => g.snapshot());
    const links = await graphApi(page, (g) => g.links());
    const ids = new Set(nodes.map((node) => node.id));
    expect(links.every((link) => ids.has(link.source) && ids.has(link.target))).toBe(true);
    // tocar até o fim
    await page.locator('#grafo-play').click();
    await expect.poll(countAt, { timeout: 20000 }).toBe(NOTAS.length);
    await expect(page.locator('#grafo-play')).toHaveAttribute('aria-label', /Reproduzir/, {
      timeout: 5000,
    });
  } finally {
    await app.close();
  }
});

test('grafo: modo Estantes agrupa, soma as ligações e expande ao clicar', async () => {
  const { app, page } = await openGraph('dark');
  try {
    await page.locator('[data-graph-view="estantes"]').click();
    await expect(page.locator('[data-graph-view="estantes"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('#grafo-contagem')).toContainText('4 estantes');
    await settled(page);
    const nodes = await graphApi(page, (g) => g.snapshot());
    expect(nodes.every((node) => node.kind === 'shelf')).toBe(true);
    const estudos = nodes.find((node) => node.shelf === 'Estudos');
    const leituras = nodes.find((node) => node.shelf === 'Leituras');
    expect(estudos.r).toBeGreaterThan(leituras.r - 0.01);
    const links = await graphApi(page, (g) => g.links());
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => link.kind === 'shelf' && link.weight >= 1)).toBe(true);
    expect(links.some((link) => link.weight > 1)).toBe(true);
    // clique duplo na estante expande
    const box = await page.locator('#grafo-canvas').boundingBox();
    const screen = await graphApi(page, (g, id) => g.toScreen(id), estudos.id);
    await page.mouse.dblclick(box.x + screen.x, box.y + screen.y);
    await expect
      .poll(
        async () =>
          (await graphApi(page, (g) => g.snapshot())).filter(
            (node) => node.shelf === 'Estudos' && node.kind === 'note',
          ).length,
      )
      .toBeGreaterThan(1);
    expect(await graphApi(page, (g) => g.expanded)).toContain('Estudos');
    // modo Tags: pontos de tag
    await page.locator('[data-graph-view="tags"]').click();
    await expect
      .poll(
        async () =>
          (await graphApi(page, (g) => g.snapshot())).filter((node) => node.kind === 'tag').length,
      )
      .toBeGreaterThan(3);
  } finally {
    await app.close();
  }
});
