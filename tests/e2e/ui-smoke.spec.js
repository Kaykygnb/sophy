const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const artifacts = '/opt/cursor/artifacts';

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-e2e-'));
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Livro'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Entrada'), { recursive: true });
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Leitura.md'),
    `---
tags:
  - estudo
---
# Leitura espaçada

A memória se liga a [[Estudos/Grafo|o grafo]] e também a um [[ incompleto.

- [/] revisar o capítulo 📅 2026-11-20 ⏫
`,
  );
  fs.writeFileSync(
    path.join(root, 'Estudos', 'Grafo.md'),
    '# Grafo\n\nCada nota é um nó. A aresta nasce do wikilink.\n',
  );
  fs.writeFileSync(
    path.join(root, 'Livro', 'Capitulo.md'),
    '# Capítulo\n\nVoltar para [[Estudos/Leitura]].\n',
  );
  return root;
}

function env() {
  const copy = { ...process.env };
  delete copy.ELECTRON_RUN_AS_NODE;
  copy.NODE_OPTIONS = '--experimental-strip-types';
  return copy;
}

async function launch(args) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-data-'));
  return electron.launch({
    args: ['.', `--test-user-data=${userData}`, ...args],
    env: env(),
  });
}

test('a janela abre a biblioteca e mostra a nota', async () => {
  test.setTimeout(90000);
  fs.mkdirSync(artifacts, { recursive: true });
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await expect(page.locator('.titulo')).toBeVisible();
  await page.getByRole('button', { name: 'Leitura' }).click();
  await expect(page.locator('.coluna')).toContainText('memória se liga');
  await expect(page.locator('.wikilink')).toContainText('o grafo');
  await expect(page.locator('body')).toContainText('2026-11-20');
  await page.screenshot({ path: path.join(artifacts, 'ui-editor-claro.png') });
  await page.getByRole('button', { name: 'Mostrar grafo' }).click();
  await expect(page.locator('#grafo-canvas')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-grafo-claro.png') });
  expect(errors).toEqual([]);
  await app.close();
});

test('boas-vindas no claro e no escuro, editor escuro', async () => {
  test.setTimeout(120000);
  const welcome = await launch([]);
  const page = await welcome.firstWindow();
  await expect(page.getByRole('heading', { name: 'Olá, eu sou a Sofi.' })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-boas-vindas-claro.png') });
  await welcome.close();

  const root = library();
  const dark = await launch([`--biblioteca=${root}`, '--theme=dark']);
  const darkPage = await dark.firstWindow();
  await darkPage.getByRole('button', { name: 'Leitura' }).click();
  await expect(darkPage.locator('.coluna')).toContainText('memória se liga');
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-editor-escuro.png') });
  await darkPage.getByRole('button', { name: 'Mostrar grafo' }).click();
  await expect(darkPage.locator('#grafo-canvas')).toBeVisible();
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-grafo-escuro.png') });
  await dark.close();

  const welcomeDark = await launch(['--theme=dark']);
  const welcomeDarkPage = await welcomeDark.firstWindow();
  await expect(welcomeDarkPage.getByRole('heading', { name: 'Olá, eu sou a Sofi.' })).toBeVisible();
  await welcomeDarkPage.screenshot({ path: path.join(artifacts, 'ui-boas-vindas-escuro.png') });
  await welcomeDark.close();
});
