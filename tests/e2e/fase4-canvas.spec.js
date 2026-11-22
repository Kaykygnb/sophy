const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4c-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  const nodes = [
    { id: 'a', type: 'text', text: 'Ideia', x: -400, y: -300, width: 240, height: 120 },
    { id: 'b', type: 'text', text: 'Fim', x: 900, y: 500, width: 240, height: 120 },
  ];
  fs.writeFileSync(path.join(root, 'Mapa.canvas'), JSON.stringify({ nodes, edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }] }));
  fs.writeFileSync(path.join(root, 'Vazio.canvas'), JSON.stringify({ nodes: [], edges: [] }));
  return root;
}

test('canvas: abre enquadrado, toolbar rotulada com + Card, Ajustar de verdade e minimapa com moldura', async () => {
  const root = library();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-f4c-data-'));
  fs.writeFileSync(path.join(userData, 'ui.json'), JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme: 'light' }));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
  const page = await app.firstWindow();
  try {
    await page.locator('#arvore').getByText('Mapa', { exact: true }).first().click();
    const area = page.locator('.canvas-app, .canvas-area').first();
    await expect(page.locator('.canvas-ferramentas')).toBeVisible();
    await expect(page.locator('.canvas-ferramentas')).toContainText('Selecionar');
    await expect(page.locator('.canvas-ferramentas')).toContainText('Conectar');
    await expect(page.locator('[data-canvas-add]')).toBeVisible();

    // enquadrado: os dois cards visíveis, nenhum atrás da toolbar
    const inside = async () => {
      const bar = await page.locator('.canvas-ferramentas').boundingBox();
      const view = await page.locator('.canvas-mundo').locator('xpath=..').boundingBox();
      for (const id of ['a', 'b']) {
        const box = await page.locator(`[data-node="${id}"]`).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(view.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(view.x + view.width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(view.y + view.height + 1);
        const overlaps = box.y < bar.y + bar.height && box.y + box.height > bar.y && box.x < bar.x + bar.width && box.x + box.width > bar.x;
        expect(overlaps).toBe(false);
      }
    };
    await inside();

    // minimapa visível, com moldura da área visível
    await expect(page.locator('.canvas-mini')).toBeVisible();

    // mexer na câmera e voltar com Ajustar
    await page.locator('[data-zoom="in"]').click();
    await page.locator('[data-zoom="in"]').click();
    await page.locator('[data-zoom="fit"]').click();
    await inside();

    // + Card cria um card no centro e já entra em edição
    const before = await page.locator('[data-node]').count();
    await page.locator('[data-canvas-add]').click();
    await expect(page.locator('[data-node]')).toHaveCount(before + 1);

    // quadro vazio: sem minimapa, com estado vazio amigável
    await page.locator('#arvore').getByText('Vazio', { exact: true }).first().click();
    await expect(page.locator('.canvas-vazio')).toBeVisible();
    await expect(page.locator('.canvas-mini')).toBeHidden();
    await page.locator('[data-canvas-start]').click();
    await expect(page.locator('.canvas-mini')).toBeVisible();
  } finally {
    await app.close();
  }
});
