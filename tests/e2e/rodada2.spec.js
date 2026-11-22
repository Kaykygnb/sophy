const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sophy-r2-${process.pid}-`));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Estudos', 'Leitura.md'), '# Leitura\n\nTexto.\n');
  fs.writeFileSync(path.join(root, 'Estudos', 'A.md'), '# A\n\nNota A.\n');
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Mapa.canvas'),
    JSON.stringify({
      nodes: [{ id: 'c', type: 'text', x: 40, y: 40, width: 240, height: 120, text: 'card **negrito** *ital*' }],
      edges: [],
    }),
  );
  for (const [name, body] of Object.entries(files))
    fs.writeFileSync(path.join(root, 'Estudos', name), body);
  return root;
}

async function launch(root) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `sophy-r2-data-${process.pid}-`));
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

test('duas aberturas seguidas não apagam o que foi digitado', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.evaluate(() => {
    const original = tool;
    let delayed = false;
    tool = async (name, input) => {
      if (!delayed && name === 'note.read' && input.path === 'Estudos/Leitura.md') {
        delayed = true;
        await new Promise((resolve) => { window.releaseOpen = resolve; });
      }
      return original(name, input);
    };
  });
  await page.locator('#arvore [data-open="Estudos/Leitura.md"]').click();
  await page.locator('#arvore [data-open="Estudos/A.md"]').click();
  await page.locator('.bloco--texto').first().click();
  await page.keyboard.type(' RACE');
  await page.evaluate(() => window.releaseOpen());
  await page.waitForTimeout(1200);
  await expect(page.locator('.bloco--texto').first()).toContainText('RACE');
  expect(fs.readFileSync(path.join(root, 'Estudos', 'A.md'), 'utf8')).toContain('RACE');
  await app.close();
});

test('Ctrl+W logo depois de digitar grava o texto', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('.bloco--texto').first().click();
  await page.keyboard.type(' CTRLW');
  await page.keyboard.press('Control+W');
  await page.waitForTimeout(400);
  expect(fs.readFileSync(path.join(root, 'Estudos', 'Leitura.md'), 'utf8')).toContain('CTRLW');
  await app.close();
});

test('renomear a estante atualiza a aba e as conexões', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('#arvore [data-shelf="Estudos"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Renomear' }).click();
  await page.locator('[data-rename="shelf"]').fill('Estudos 2026');
  await page.locator('[data-rename="shelf"]').press('Enter');
  await expect(page.locator('[data-tab="Estudos 2026/Leitura.md"]')).toBeVisible();
  await page.locator('[data-tab="Estudos 2026/Leitura.md"]').click();
  await expect(page.locator('.toast--erro')).toHaveCount(0);
  await expect(page.locator('.bloco--texto').first()).toContainText('Texto');
  expect(fs.existsSync(path.join(root, 'Estudos 2026', 'Leitura.md'))).toBe(true);
  await app.close();
});

test('editar o cartão do canvas guarda o markdown e Selecionar usa a seta', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.locator('#arvore [data-canvas="Estudos/Mapa.canvas"]').click();
  await expect(page.locator('[data-tool="select"] use')).toHaveAttribute('href', '#i-selecionar');
  await page.locator('.cv-texto').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' mais');
  await page.locator('.canvas-area').click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(400);
  const saved = fs.readFileSync(path.join(root, 'Estudos', 'Mapa.canvas'), 'utf8');
  expect(saved).toContain('**negrito**');
  expect(saved).toMatch(/\*ital(?:\s+mais)?\*/);
  expect(saved).toContain('mais');
  expect(saved).not.toContain('"text":""');
  await app.close();
});

test('Conexões na janela estreita não reabre a Sofi e desliza', async () => {
  const root = library();
  const { app, page } = await launch(root);
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.keyboard.press('Control+J');
  await expect(page.locator('#conexoes h3')).toHaveText('Sofi');
  await page.setViewportSize({ width: 800, height: 700 });
  await page.getByRole('button', { name: 'Conexões' }).click();
  await expect(page.locator('#conexoes')).toHaveClass(/is-gaveta/);
  await expect(page.locator('#conexoes')).toHaveClass(/is-aberta/);
  await expect(page.locator('#conexoes')).toContainText('Links de saída');
  await expect(page.locator('#conexoes')).not.toContainText('Guardar no cofre');
  const transition = await page.locator('#conexoes').evaluate((el) => getComputedStyle(el).transitionProperty);
  expect(transition).toContain('transform');
  await app.close();
});
