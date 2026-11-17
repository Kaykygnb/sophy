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

- [ ] abrir o capítulo
- [/] revisar o capítulo 📅 2026-11-20 ⏫
- [x] capítulo lido
- [-] capítulo cancelado
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
  for (const shelf of ['Pesquisa', 'Trabalho', 'Diário', 'Leituras']) {
    fs.mkdirSync(path.join(root, shelf), { recursive: true });
    fs.writeFileSync(
      path.join(root, shelf, 'Nota.md'),
      `# ${shelf}\n\nLiga com [[Estudos/Leitura]].\n`,
    );
  }
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

test('troca de biblioteca, formatação e comandos', async () => {
  test.setTimeout(60000);
  const first = library();
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-outra-'));
  fs.mkdirSync(path.join(second, '.sophy'));
  fs.writeFileSync(path.join(second, 'Outra.md'), '# Outra biblioteca\n');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-data-'));
  fs.writeFileSync(
    path.join(userData, 'ui.json'),
    JSON.stringify({
      onboarded: true,
      libraryPath: first,
      libraries: [first, second],
      theme: 'light',
    }),
  );
  const app = await electron.launch({
    args: ['.', `--test-user-data=${userData}`],
    env: env(),
  });
  const page = await app.firstWindow();
  fs.mkdirSync(artifacts, { recursive: true });
  await page.locator('#seletor-biblioteca').click();
  await expect(page.getByRole('menuitem', { name: 'Nova biblioteca…' })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-bibliotecas-claro.png') });
  await page.getByRole('menuitem', { name: path.basename(second) }).click();
  await expect(page.getByRole('button', { name: 'Outra', exact: true })).toBeVisible();
  await page.locator('#seletor-biblioteca').click();
  await page.getByRole('menuitem', { name: path.basename(first) }).click();
  await page.getByRole('button', { name: 'Leitura', exact: true }).click();
  await page.locator('.bloco--texto').first().evaluate((el) => {
    const text = [...el.childNodes].find((node) => node.nodeType === 3 && node.textContent.trim());
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(6, text.textContent.length));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.locator('.bloco-linha').first().hover();
  await expect(page.locator('.barra-formato')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-formato-claro.png') });
  await page.locator('.barra-formato button[aria-label="Negrito"]').click();
  await expect
    .poll(() => fs.readFileSync(path.join(first, 'Estudos', 'Leitura.md'), 'utf8'))
    .toContain('**');
  await page.locator('.bloco-linha').first().hover();
  await expect(page.locator('.bloco__mais').first()).toBeVisible();
  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByRole('dialog', { name: 'Comandos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nova biblioteca' })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-comandos-claro.png') });
  await app.close();

  const marked = fs.readFileSync(path.join(first, 'Estudos', 'Leitura.md'), 'utf8');
  fs.writeFileSync(path.join(first, 'Estudos', 'Leitura.md'), marked.replace(/\*\*([^*]+)\*\*/g, '$1'));
  const darkData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-ui-data-'));
  fs.writeFileSync(
    path.join(darkData, 'ui.json'),
    JSON.stringify({
      onboarded: true,
      libraryPath: first,
      libraries: [first, second],
      theme: 'dark',
    }),
  );
  const dark = await electron.launch({
    args: ['.', `--test-user-data=${darkData}`],
    env: env(),
  });
  const darkPage = await dark.firstWindow();
  await darkPage.locator('#seletor-biblioteca').click();
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-bibliotecas-escuro.png') });
  await darkPage.keyboard.press('Escape');
  await darkPage.getByRole('button', { name: 'Leitura', exact: true }).click();
  await darkPage.locator('.bloco--texto').first().evaluate((el) => {
    const text = [...el.childNodes].find((node) => node.nodeType === 3 && node.textContent.trim());
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(6, text.textContent.length));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await darkPage.locator('.bloco-linha').first().hover();
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-formato-escuro.png') });
  await darkPage.keyboard.press('Control+Shift+P');
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-comandos-escuro.png') });
  await dark.close();
});

test('Nota e Estante criam arquivos sem diálogo nativo', async () => {
  test.setTimeout(60000);
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  await page.locator('#nova-nota').click();
  await expect(page.locator('.bloco--titulo')).toHaveText('Sem título');
  expect(fs.existsSync(path.join(root, 'Entrada', 'Sem título.md'))).toBe(true);
  await page.locator('#nova-estante').click();
  const name = page.locator('#nome-estante');
  await name.fill('Viagem');
  await name.press('Enter');
  await expect(page.locator('[data-shelf="Viagem"]')).toBeVisible();
  expect(fs.existsSync(path.join(root, 'Viagem'))).toBe(true);
  expect(fs.statSync(path.join(root, 'Viagem')).isDirectory()).toBe(true);
  await app.close();
});

test('a janela abre a biblioteca e mostra a nota', async () => {
  test.setTimeout(90000);
  fs.mkdirSync(artifacts, { recursive: true });
  const root = library();
  const app = await launch([`--biblioteca=${root}`, '--theme=light']);
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await expect(page.locator('.titulo')).toBeVisible();
  await page.getByRole('button', { name: 'Leitura', exact: true }).click();
  await expect(page.locator('.coluna')).toContainText('memória se liga');
  await expect(page.locator('.wikilink')).toContainText('o grafo');
  await expect(page.locator('.nota__meta')).toContainText('#estudo');
  await expect(page.locator('body')).toContainText('2026-11-20');
  const fontsReady = await page.evaluate(async () => {
    await document.fonts.ready;
    return (
      document.fonts.check('600 32px Fraunces') &&
      document.fonts.check('400 16px Inter') &&
      document.fonts.check('400 14px "JetBrains Mono"')
    );
  });
  expect(fontsReady).toBe(true);
  await expect(page.locator('.arvore__linha[style*="--nivel:2"]').first()).toBeVisible();
  await expect(page.locator('.check[data-status="feita"]')).toBeVisible();
  await expect(page.locator('.check[data-status="andamento"]')).toBeVisible();
  await expect(page.locator('.check[data-status="cancelada"]')).toBeVisible();
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await page.keyboard.press('Control+k');
  await page.locator('#paleta-q').fill('memória');
  await expect(page.locator('.menu__grupo').first()).toContainText('Notas');
  await page.screenshot({ path: path.join(artifacts, 'ui-busca-claro.png') });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(artifacts, 'ui-editor-claro.png') });
  await page.getByRole('button', { name: 'Mostrar grafo' }).click();
  await expect(page.locator('#grafo-canvas')).toBeVisible();
  await expect(page.locator('.grafo__legenda')).toContainText('Estudos');
  await expect(page.locator('#conexoes')).toContainText('Leitura');
  await expect(page.locator('#conexoes')).not.toContainText('Abra uma nota');
  await page.screenshot({ path: path.join(artifacts, 'ui-grafo-claro.png') });
  expect(errors).toEqual([]);
  await app.close();
});

test('boas-vindas no claro e no escuro, editor escuro', async () => {
  test.setTimeout(120000);
  const welcome = await launch([]);
  const page = await welcome.firstWindow();
  await expect(page.getByRole('heading', { name: 'Olá, eu sou a Sofi.' })).toBeVisible();
  await expect(page.locator('body')).toContainText('Só funciona se você conectar uma chave.');
  await expect(page.locator('body')).not.toContainText('etapa seguinte');
  await expect(page.getByRole('button', { name: 'Voltar' })).toHaveCount(0);
  await expect(page.locator('[data-window="close"]')).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'ui-boas-vindas-claro.png') });
  await welcome.close();

  const root = library();
  const dark = await launch([`--biblioteca=${root}`, '--theme=dark']);
  const darkPage = await dark.firstWindow();
  await darkPage.getByRole('button', { name: 'Leitura', exact: true }).click();
  await expect(darkPage.locator('.coluna')).toContainText('memória se liga');
  await expect(darkPage.locator('.check[data-status="feita"]')).toBeVisible();
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-editor-escuro.png') });
  await darkPage.keyboard.press('Control+k');
  await darkPage.locator('#paleta-q').fill('memória');
  await expect(darkPage.locator('.menu__grupo').first()).toContainText('Notas');
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-busca-escuro.png') });
  await darkPage.keyboard.press('Escape');
  await darkPage.getByRole('button', { name: 'Mostrar grafo' }).click();
  await expect(darkPage.locator('#grafo-canvas')).toBeVisible();
  await expect(darkPage.locator('#conexoes')).toContainText('Leitura');
  await darkPage.screenshot({ path: path.join(artifacts, 'ui-grafo-escuro.png') });
  await dark.close();

  const welcomeDark = await launch(['--theme=dark']);
  const welcomeDarkPage = await welcomeDark.firstWindow();
  await expect(welcomeDarkPage.getByRole('heading', { name: 'Olá, eu sou a Sofi.' })).toBeVisible();
  await welcomeDarkPage.screenshot({ path: path.join(artifacts, 'ui-boas-vindas-escuro.png') });
  await welcomeDark.close();
});
