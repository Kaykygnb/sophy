const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-grafo-ui-'));
  const notes = [
    [
      'Estudos/Memoria.md',
      '---\ntags:\n  - estudo\n---\n# Memória de trabalho\n\nVer [[Estudos/Feynman|método]] e [[Trabalho/Reuniao]]. Também [[Estudos/Sono]] e [[NaoExiste]].\n',
    ],
    [
      'Estudos/Feynman.md',
      '# Método Feynman\n\nVolta para [[Estudos/Memoria]] e [[Estudos/Citacoes]].\n',
    ],
    ['Estudos/Sono.md', '# Sono\n\nLiga com [[Estudos/Memoria]].\n'],
    ['Estudos/Citacoes.md', '# Citações\n\nUma nota pequena.\n'],
    ['Trabalho/Reuniao.md', '# Reunião\n\nLiga com [[Estudos/Memoria]] e [[Diario/Hoje]].\n'],
    ['Diario/Hoje.md', '# Hoje\n\n[[Trabalho/Reuniao]]\n'],
    ['Solta.md', '# Nota solta\n\nSem links e sem frontmatter.\n'],
  ];
  for (const [relative, body] of notes) {
    const full = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Mapa.canvas'),
    JSON.stringify({
      nodes: [
        {
          id: 't',
          type: 'text',
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          text: 'Veja [[Estudos/Memoria]]',
        },
      ],
      edges: [],
    }),
  );
  fs.writeFileSync(path.join(root, 'Estudos', 'foto.png'), Buffer.from('png'));
  return root;
}

function env() {
  const copy = { ...process.env };
  delete copy.ELECTRON_RUN_AS_NODE;
  copy.NODE_OPTIONS = '--experimental-strip-types';
  return copy;
}

async function launch(root) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-grafo-data-'));
  fs.writeFileSync(
    path.join(userData, 'ui.json'),
    JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme: 'light' }),
  );
  const app = await electron.launch({
    args: ['.', `--test-user-data=${userData}`],
    env: env(),
  });
  const page = await app.firstWindow();
  await page.locator('#ver-grafo').click();
  await page.waitForFunction(
    () => {
      const host = document.querySelector('.grafo');
      return host && host.dataset.estado === 'pronto' && host._grafo && host._grafo.settled();
    },
    null,
    { timeout: 20000 },
  );
  return { app, page };
}

async function counts(page) {
  return page.evaluate(() => document.querySelector('.grafo')._grafo.counts());
}

test('arrastar um nó muda a posição e não abre a nota', async () => {
  const { app, page } = await launch(library());
  const before = await page.evaluate(() =>
    document.querySelector('.grafo')._grafo.worldPosition('Estudos/Memoria.md'),
  );
  const at = await page.evaluate(() =>
    document.querySelector('.grafo')._grafo.screenPosition('Estudos/Memoria.md'),
  );
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 180, at.y + 24, { steps: 12 });
  const during = await page.evaluate(() =>
    document.querySelector('.grafo')._grafo.worldPosition('Estudos/Memoria.md'),
  );
  await page.mouse.up();
  await page.waitForTimeout(450);
  expect(Math.hypot(during.x - before.x, during.y - before.y)).toBeGreaterThan(40);
  await expect(page.locator('#coluna')).toHaveCount(0);
  await expect(page.locator('canvas#grafo-canvas')).toBeVisible();
  await app.close();
});

test('clicar num nó abre a nota e o foco continua nela', async () => {
  const { app, page } = await launch(library());
  const at = await page.evaluate(() =>
    document.querySelector('.grafo')._grafo.screenPosition('Estudos/Memoria.md'),
  );
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('#coluna')).toContainText('Memória de trabalho');
  await page.locator('#ver-grafo').click();
  await expect(page.locator('.grafo')).toHaveAttribute('data-foco', 'Estudos/Memoria.md');
  await app.close();
});

test('passar o mouse esmaece o que não é vizinho', async () => {
  const { app, page } = await launch(library());
  const at = await page.evaluate(() =>
    document.querySelector('.grafo')._grafo.screenPosition('Estudos/Memoria.md'),
  );
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(280);
  const faded = await page.evaluate(() =>
    document.querySelector('.grafo')._grafo.opacity('Solta.md'),
  );
  const neighbor = await page.evaluate(() =>
    document.querySelector('.grafo')._grafo.opacity('Estudos/Feynman.md'),
  );
  const coldEdge = await page.evaluate(() =>
    document
      .querySelector('.grafo')
      ._grafo.edgeOpacity('Estudos/Feynman.md', 'Estudos/Citacoes.md'),
  );
  const hotEdge = await page.evaluate(() =>
    document.querySelector('.grafo')._grafo.edgeOpacity('Estudos/Memoria.md', 'Estudos/Feynman.md'),
  );
  expect(faded).toBeGreaterThan(0.2);
  expect(faded).toBeLessThan(0.55);
  expect(neighbor).toBeGreaterThan(0.9);
  expect(coldEdge).toBeGreaterThan(0.1);
  expect(coldEdge).toBeLessThan(0.35);
  expect(hotEdge).toBeGreaterThan(0.9);
  await app.close();
});

test('Global, Local, profundidade e filtros', async () => {
  const { app, page } = await launch(library());
  await expect.poll(() => counts(page)).toMatchObject({ notes: 7 });
  const broken = await page.evaluate(() =>
    document.querySelector('.grafo')._grafo.broken('Estudos/Memoria.md'),
  );
  expect(broken).toBeGreaterThan(0);
  await page.getByRole('radio', { name: 'Local' }).check();
  await expect(page.locator('#grafo-centro')).toBeVisible();
  await page.locator('#grafo-centro').selectOption('Estudos/Memoria.md');
  await page.getByRole('radio', { name: 'Profundidade 1' }).check();
  await expect.poll(async () => (await counts(page)).notes).toBe(4);
  await page.getByRole('radio', { name: 'Profundidade 2' }).check();
  await expect.poll(async () => (await counts(page)).notes).toBe(6);
  await page.getByRole('radio', { name: 'Global' }).check();
  await expect.poll(async () => (await counts(page)).notes).toBe(7);
  await page.locator('#grafo-filtros').click();
  await page.getByRole('checkbox', { name: 'Trabalho' }).uncheck();
  await expect.poll(async () => (await counts(page)).notes).toBe(6);
  await page.getByRole('checkbox', { name: 'Esconder notas órfãs' }).check();
  await expect.poll(async () => (await counts(page)).notes).toBe(5);
  await page.locator('#grafo-tag').fill('estudo');
  await expect.poll(async () => (await counts(page)).notes).toBe(1);
  await page.locator('#grafo-tag').fill('');
  await page.getByRole('checkbox', { name: 'Mostrar canvas' }).check();
  await expect
    .poll(async () =>
      page.evaluate(() => document.querySelector('.grafo')._grafo.kind('Estudos/Mapa.canvas')),
    )
    .toBe('canvas');
  await app.close();
});

test('os sliders de Forças persistem', async () => {
  const { app, page } = await launch(library());
  await page.locator('#grafo-forca-repulsao').evaluate((input) => {
    input.value = '0.2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#grafo-forca-repulsao')).toHaveValue('0.2');
  await page.reload();
  await page.locator('#ver-grafo').click();
  await expect(page.locator('#grafo-forca-repulsao')).toHaveValue('0.2');
  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem('sophy.ui.graph')).forces.repulsion,
  );
  expect(stored).toBe(0.2);
  await app.close();
});
