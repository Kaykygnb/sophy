const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-sergio-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Estudos', 'Leitura.md'), '# Leitura\n\nTexto.\n');
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Mapa.canvas'),
    JSON.stringify({ nodes: [], edges: [] }),
  );
  for (const [name, body] of Object.entries(files))
    fs.writeFileSync(path.join(root, 'Estudos', name), body);
  return root;
}

async function launch(root) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-sergio-data-'));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ['.', `--test-user-data=${userData}`, `--biblioteca=${root}`, '--theme=light'],
    env,
  });
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Leitura', exact: true }).click();
  return { app, page };
}

test('clicar a versão só mostra a prévia', async () => {
  const root = library({ 'A.md': '# A\n\nOriginal.\n' });
  const { app, page } = await launch(root);
  await page.locator('#arvore [data-open="Estudos/A.md"]').click();
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true })),
  );
  await page.locator('#comando-q').fill('Histórico');
  await page.locator('#comando-lista .menu__item', { hasText: 'Histórico de versões' }).click();
  await page.getByRole('button', { name: 'Gravar ponto agora' }).click();
  await page.locator('[data-versao]').first().click();
  await page.waitForTimeout(400);
  expect(fs.readFileSync(path.join(root, 'Estudos', 'A.md'), 'utf8')).toContain('Original.');
  await expect(page.getByRole('button', { name: 'Restaurar esta versão' })).toBeVisible();
  await app.close();
});

test('parágrafo com link markdown não embaralha a digitação', async () => {
  const root = library({ 'L.md': '# L\n\n[Terceiro](https://) parágrafo.\n' });
  const { app, page } = await launch(root);
  await page.locator('#arvore [data-open="Estudos/L.md"]').click();
  const paragraph = page.locator('.bloco--texto').first();
  await paragraph.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' mais texto');
  await page.waitForTimeout(700);
  expect(fs.readFileSync(path.join(root, 'Estudos', 'L.md'), 'utf8')).toContain('parágrafo. mais texto');
  await app.close();
});

test('--- seguido de Enter recebe o texto seguinte', async () => {
  const root = library({ 'H.md': '# H\n\nAntes.\n' });
  const { app, page } = await launch(root);
  await page.locator('#arvore [data-open="Estudos/H.md"]').click();
  await page.locator('.bloco--texto').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('---');
  await page.keyboard.press('Enter');
  await page.keyboard.type('depois da linha');
  await page.waitForTimeout(700);
  const saved = fs.readFileSync(path.join(root, 'Estudos', 'H.md'), 'utf8');
  expect(saved).toContain('---');
  expect(saved).toContain('depois da linha');
  await app.close();
});

test('Esc sai do modo foco e Ctrl+Shift+Enter não vira tarefa', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('.bloco--texto').first().click();
  await page.keyboard.press('Control+Shift+Enter');
  await expect(page.locator('#shell')).toHaveClass(/is-foco/);
  await expect(page.locator('#modo-foco')).toHaveText('Sair do foco');
  await page.keyboard.press('Escape');
  await expect(page.locator('#shell')).not.toHaveClass(/is-foco/);
  const saved = fs.readFileSync(path.join(root, 'Estudos', 'Leitura.md'), 'utf8');
  expect(saved).not.toContain('- [ ]');
  await app.close();
});

test('aba fecha com o botão e o canvas não marca Hoje', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('[data-fechar-aba="Estudos/Leitura.md"]').click();
  await expect(page.locator('[data-tab="Estudos/Leitura.md"]')).toHaveCount(0);
  await page.locator('#arvore [data-canvas="Estudos/Mapa.canvas"]').click();
  await expect(page.locator('.canvas-area')).toBeVisible();
  await expect(page.locator('[data-nav="hoje"]')).not.toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-tab="Estudos/Mapa.canvas"] use')).toHaveAttribute('href', '#i-canvas');
  const direction = await page.locator('.canvas-ferramentas').evaluate((el) => getComputedStyle(el).flexDirection);
  expect(direction).toBe('row');
  const top = await page.locator('.canvas-ferramentas').evaluate((el) => getComputedStyle(el).top);
  expect(top).not.toBe('auto');
  await app.close();
});

test('conexões viram gaveta abaixo de 1024 px', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.setViewportSize({ width: 800, height: 700 });
  await page.getByRole('button', { name: 'Conexões' }).click();
  await expect(page.locator('#conexoes')).toHaveClass(/is-gaveta/);
  await expect(page.locator('#gaveta-veu')).toBeVisible();
  await page.locator('#gaveta-veu').click();
  await expect(page.locator('#conexoes')).not.toHaveClass(/is-gaveta/);
  await app.close();
});

test('cartão de texto do canvas recebe o foco e formata negrito', async () => {
  const root = library({
    'Quadro.canvas': JSON.stringify({
      nodes: [{ id: 'c', type: 'text', x: 40, y: 40, width: 240, height: 120, text: 'card **negrito**' }],
      edges: [],
    }),
  });
  const { app, page } = await launch(root);
  await page.locator('#arvore [data-canvas="Estudos/Quadro.canvas"]').click();
  await expect(page.locator('.cv-texto strong')).toHaveText('negrito');
  await page.locator('[data-tool="rectangle"]').click();
  await page.locator('.canvas-area').click({ position: { x: 80, y: 200 } });
  await expect(page.locator('.cv-texto').last()).toBeFocused();
  await app.close();
});
