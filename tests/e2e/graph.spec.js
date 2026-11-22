const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-graph-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Trabalho'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Memoria.md'),
    '---\ntags: [estudo]\n---\n# Memória\n\nConecta com [[Estudos/Foco]].\n',
  );
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Foco.md'),
    '---\ntags: [estudo]\n---\n# Atenção e foco\n\nConecta com [[Estudos/Memoria]].\n',
  );
  fs.writeFileSync(
    path.join(root, 'Trabalho', 'Reuniao.md'),
    '# Reunião semanal\n\nUma nota de trabalho.\n',
  );
  return root;
}

test('grafo permite buscar, arrastar um nó, mover câmera e salvar posição', async () => {
  const root = makeLibrary();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-graph-data-'));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    args: ['.', `--test-user-data=${userData}`, `--biblioteca=${root}`],
    env,
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Grafo', exact: true }).click();
    await expect(page.locator('#grafo-canvas')).toBeVisible();
    await expect(page.locator('#grafo-contagem')).toContainText('3 notas');

    await page.locator('#grafo-busca').fill('Memoria');
    await expect(page.locator('#grafo-contagem')).toContainText('1 nota');
    await page.locator('#grafo-busca').press('Enter');
    const canvas = page.locator('#grafo-canvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2 + 35, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('#grafo-chips')).toContainText('Busca: Memoria');
    await expect
      .poll(() =>
        page.evaluate((libraryPath) => localStorage.getItem(`sophy-graph:${libraryPath}`), root),
      )
      .toBeTruthy();

    await page.locator('#grafo-forcas-toggle').click();
    await expect(page.locator('#grafo-forcas')).toBeVisible();
    await page.locator('[data-graph-mode="local"]').click();
    await expect(page.locator('#grafo-local')).toBeVisible();
    await page.locator('#grafo-ajustar').click();
  } finally {
    await app.close();
  }
});
